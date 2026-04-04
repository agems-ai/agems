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

function createByFormat(format: ApiFormat, config: { apiKey?: string; baseUrl?: string; model: string }): any {
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
      const provider = createOpenAI({ apiKey: config.apiKey, compatibility: 'compatible', ...(config.baseUrl && { baseURL: config.baseUrl }) } as any);
      return provider.chat(config.model);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createProvider(config: AIProviderConfig): any {
  // If apiFormat is explicitly set, use format-based routing with baseUrl
  if (config.apiFormat) {
    const baseUrl = config.baseUrl || DEFAULT_BASE_URLS[config.provider];
    return createByFormat(config.apiFormat, { apiKey: config.apiKey, baseUrl, model: config.model });
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
      return createByFormat('openai', { apiKey: 'ollama', baseUrl: config.baseUrl || DEFAULT_BASE_URLS.OLLAMA, model: config.model });
    case 'CUSTOM': {
      if (!config.baseUrl) throw new Error('Custom provider requires baseUrl');
      return createByFormat('openai', { apiKey: config.apiKey || '', baseUrl: config.baseUrl, model: config.model });
    }
    default: {
      // All other providers: OpenAI-compatible with their default base URL
      const baseUrl = config.baseUrl || DEFAULT_BASE_URLS[config.provider];
      if (!baseUrl) throw new Error(`Unknown provider: ${config.provider}`);
      return createByFormat('openai', { apiKey: config.apiKey, baseUrl, model: config.model });
    }
  }
}
