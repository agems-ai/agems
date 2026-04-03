import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export interface AIProviderConfig {
  provider: 'ANTHROPIC' | 'OPENAI' | 'GOOGLE' | 'DEEPSEEK' | 'MISTRAL' | 'MINIMAX' | 'GLM' | 'XAI' | 'COHERE' | 'PERPLEXITY' | 'TOGETHER' | 'FIREWORKS' | 'GROQ' | 'MOONSHOT' | 'QWEN' | 'AI21' | 'SAMBANOVA' | 'OLLAMA' | 'CUSTOM';
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createProvider(config: AIProviderConfig): any {
  switch (config.provider) {
    case 'ANTHROPIC': {
      const anthropic = createAnthropic({ apiKey: config.apiKey });
      return anthropic(config.model);
    }
    case 'OPENAI': {
      const openai = createOpenAI({ apiKey: config.apiKey });
      return openai(config.model);
    }
    case 'GOOGLE': {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
      return google(config.model);
    }
    case 'DEEPSEEK': {
      const deepseek = createDeepSeek({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return deepseek(config.model);
    }
    case 'MISTRAL': {
      const mistral = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.mistral.ai/v1',
      });
      return mistral.chat(config.model);
    }
    case 'MINIMAX': {
      const minimax = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.minimaxi.chat/v1',
      });
      return minimax.chat(config.model);
    }
    case 'GLM': {
      const glm = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://open.bigmodel.cn/api/paas/v4',
      });
      return glm.chat(config.model);
    }
    case 'XAI': {
      const xai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.x.ai/v1',
      });
      return xai.chat(config.model);
    }
    case 'COHERE': {
      const cohere = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.cohere.com/compatibility/v1',
      });
      return cohere.chat(config.model);
    }
    case 'PERPLEXITY': {
      const perplexity = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.perplexity.ai',
      });
      return perplexity.chat(config.model);
    }
    case 'TOGETHER': {
      const together = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.together.xyz/v1',
      });
      return together.chat(config.model);
    }
    case 'FIREWORKS': {
      const fireworks = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.fireworks.ai/inference/v1',
      });
      return fireworks.chat(config.model);
    }
    case 'GROQ': {
      const groq = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.groq.com/openai/v1',
      });
      return groq.chat(config.model);
    }
    case 'MOONSHOT': {
      const moonshot = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.moonshot.cn/v1',
      });
      return moonshot.chat(config.model);
    }
    case 'QWEN': {
      const qwen = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });
      return qwen.chat(config.model);
    }
    case 'AI21': {
      const ai21 = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.ai21.com/studio/v1',
      });
      return ai21.chat(config.model);
    }
    case 'SAMBANOVA': {
      const sambanova = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.sambanova.ai/v1',
      });
      return sambanova.chat(config.model);
    }
    case 'OLLAMA': {
      const ollama = createOpenAI({
        apiKey: 'ollama',
        baseURL: config.baseUrl || 'http://localhost:11434/v1',
      });
      return ollama.chat(config.model);
    }
    case 'CUSTOM': {
      if (!config.baseUrl) throw new Error('Custom provider requires baseUrl');
      const custom = createOpenAI({
        apiKey: config.apiKey || '',
        baseURL: config.baseUrl,
      });
      return custom.chat(config.model);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
