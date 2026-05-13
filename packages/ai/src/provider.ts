import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export type ApiFormat = 'openai' | 'anthropic' | 'google';

export interface AIProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  apiFormat?: ApiFormat;
}

// Default base URLs per provider (used when no custom baseUrl is set)
const DEFAULT_BASE_URLS: Record<string, string> = {
  MISTRAL: 'https://api.mistral.ai/v1',
  MINIMAX: 'https://api.minimax.io/anthropic/v1',
  GLM: 'https://open.bigmodel.cn/api/paas/v4',
  XAI: 'https://api.x.ai/v1',
  COHERE: 'https://api.cohere.com/compatibility/v1',
  PERPLEXITY: 'https://api.perplexity.ai',
  TOGETHER: 'https://api.together.xyz/v1',
  FIREWORKS: 'https://api.fireworks.ai/inference/v1',
  GROQ: 'https://api.groq.com/openai/v1',
  MOONSHOT: 'https://api.moonshot.cn/v1',
  QWEN: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  AI21: 'https://api.ai21.com/studio/v1',
  SAMBANOVA: 'https://api.sambanova.ai/v1',
  OLLAMA: 'http://localhost:11434/v1',
};

// Default API format per provider (native format)
const DEFAULT_API_FORMAT: Record<string, ApiFormat> = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GOOGLE: 'google',
  DEEPSEEK: 'openai',
};

// Custom fetch that injects Zhipu GLM `thinking` parameter for reasoning-capable
// models. Also extracts `reasoning_content` from the response and re-emits it
// as AI SDK-compatible reasoning so the runner can surface it as thinking.
function makeGlmFetch(): typeof fetch {
  return async (input: any, init?: any) => {
    let isReasoningRequest = false;
    try {
      if (init?.body && typeof init.body === 'string') {
        const parsed = JSON.parse(init.body);
        const modelId: string = parsed.model || '';
        const isReasoningModel = /glm-(4\.6|5|5\.1|4\.6-plus)/i.test(modelId);
        if (isReasoningModel) {
          parsed.thinking = { type: 'enabled' };
          isReasoningRequest = true;
          init = { ...init, body: JSON.stringify(parsed) };
          // eslint-disable-next-line no-console
          console.log(`[GLM-fetch] Injected thinking:enabled for ${modelId}, stream=${parsed.stream ?? false}`);
        }
      }
    } catch (e) {
      console.log(`[GLM-fetch] body parse failed: ${e}`);
    }
    const res = await fetch(input, init);
    if (!isReasoningRequest) return res;
    const ct = res.headers.get('content-type') || '';
    console.log(`[GLM-fetch] Response status=${res.status}, content-type=${ct}`);

    // SSE streaming: buffer all reasoning_content, then flush as one
    // <think>...</think> block when first real content arrives.
    if (ct.includes('text/event-stream') && res.body) {
      return transformGlmSse(res);
    }

    // JSON non-streaming: prepend reasoning as <think> block
    if (ct.includes('application/json')) {
      try {
        const data: any = await res.json();
        for (const ch of data?.choices ?? []) {
          const msg = ch?.message;
          if (!msg) continue;
          const rc = msg.reasoning_content;
          if (typeof rc === 'string' && rc.trim()) {
            msg.content = `<think>${rc}</think>\n\n${msg.content || ''}`;
            console.log(`[GLM-fetch] JSON: prepended ${rc.length} chars reasoning`);
          }
        }
        const h = new Headers(res.headers);
        h.delete('content-length');
        return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers: h });
      } catch { return res; }
    }
    return res;
  };
}

// Transform GLM SSE stream: buffer all reasoning_content chunks, then
// when the first real content delta arrives, flush the full reasoning
// as ONE <think>FULL_TEXT</think> block prepended to the content delta.
// This gives the runner a single clean <think> pair to parse.
function transformGlmSse(res: Response): Response {
  if (!res.body) return res;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = '';
  let reasoningBuffer = '';
  let reasoningFlushed = false;

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        // If we have unflushed reasoning at stream end, emit as content
        if (reasoningBuffer && !reasoningFlushed) {
          const event = `data: ${JSON.stringify({choices:[{delta:{content:`<think>${reasoningBuffer}</think>`}}]})}\n\n`;
          controller.enqueue(encoder.encode(event));
          reasoningFlushed = true;
        }
        if (sseBuffer.trim()) controller.enqueue(encoder.encode(sseBuffer));
        controller.close();
        return;
      }

      sseBuffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = sseBuffer.indexOf('\n\n')) !== -1) {
        const chunk = sseBuffer.slice(0, idx + 2);
        sseBuffer = sseBuffer.slice(idx + 2);

        // Parse the SSE event
        const match = chunk.match(/^data: (.+)/m);
        if (!match || match[1].trim() === '[DONE]') {
          controller.enqueue(encoder.encode(chunk));
          continue;
        }

        try {
          const obj = JSON.parse(match[1]);
          const delta = obj?.choices?.[0]?.delta;
          if (!delta) { controller.enqueue(encoder.encode(chunk)); continue; }

          const rc = delta.reasoning_content;
          if (typeof rc === 'string' && rc.length > 0) {
            // Accumulate reasoning, don't emit yet
            reasoningBuffer += rc;
            // Remove reasoning_content from the delta, emit empty event
            delete delta.reasoning_content;
            if (!delta.content) {
              // Skip this event entirely (reasoning-only, no content)
              continue;
            }
          }

          // If we have buffered reasoning and this is the first content delta, flush
          if (delta.content && reasoningBuffer && !reasoningFlushed) {
            delta.content = `<think>${reasoningBuffer}</think>\n\n` + delta.content;
            reasoningFlushed = true;
            console.log(`[GLM-SSE] Flushed ${reasoningBuffer.length} chars reasoning as single <think> block`);
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          controller.enqueue(encoder.encode(chunk));
        }
      }
    },
    cancel() { reader.cancel(); }
  });

  return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function createByFormat(format: ApiFormat, config: { apiKey?: string; baseUrl?: string; model: string; provider?: string }): any {
  switch (format) {
    case 'anthropic': {
      const provider = createAnthropic({ apiKey: config.apiKey, ...(config.baseUrl && { baseURL: config.baseUrl }) });
      return provider(config.model);
    }
    case 'google': {
      const provider = createGoogleGenerativeAI({ apiKey: config.apiKey, ...(config.baseUrl && { baseURL: config.baseUrl }) });
      return provider(config.model);
    }
    case 'openai':
    default: {
      const isGlm = config.provider === 'GLM';
      const provider = createOpenAI({
        apiKey: config.apiKey,
        compatibility: 'compatible',
        ...(config.baseUrl && { baseURL: config.baseUrl }),
        ...(isGlm && { fetch: makeGlmFetch() }),
      } as any);
      return provider.chat(config.model);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createProvider(config: AIProviderConfig): any {
  // If apiFormat is explicitly set, use format-based routing with baseUrl
  if (config.apiFormat) {
    const baseUrl = config.baseUrl || DEFAULT_BASE_URLS[config.provider];
    return createByFormat(config.apiFormat, { apiKey: config.apiKey, baseUrl, model: config.model, provider: config.provider });
  }

  // Native providers (use their dedicated SDKs)
  switch (config.provider) {
    case 'ANTHROPIC':
      return createByFormat('anthropic', { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model });
    case 'OPENAI':
      return createByFormat('openai', { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model });
    case 'GOOGLE':
      return createByFormat('google', { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model });
    case 'DEEPSEEK': {
      const deepseek = createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseUrl });
      return deepseek(config.model);
    }
    case 'OLLAMA':
      // Local Ollama doesn't need a real key, but a remote proxy (runpod, ngrok, etc.)
      // may require Bearer auth -- fall back to 'ollama' only when no key is provided.
      return createByFormat('openai', { apiKey: config.apiKey || 'ollama', baseUrl: config.baseUrl || DEFAULT_BASE_URLS.OLLAMA, model: config.model });
    case 'CUSTOM': {
      if (!config.baseUrl) throw new Error('Custom provider requires baseUrl');
      return createByFormat('openai', { apiKey: config.apiKey || '', baseUrl: config.baseUrl, model: config.model });
    }
    default: {
      // All other providers: OpenAI-compatible with their default base URL
      const baseUrl = config.baseUrl || DEFAULT_BASE_URLS[config.provider];
      if (!baseUrl) throw new Error(`Unknown provider: ${config.provider}`);
      return createByFormat('openai', { apiKey: config.apiKey, baseUrl, model: config.model, provider: config.provider });
    }
  }
}
