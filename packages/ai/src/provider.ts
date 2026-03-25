import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export interface AIProviderConfig {
  provider: 'ANTHROPIC' | 'OPENAI' | 'GOOGLE' | 'DEEPSEEK' | 'MISTRAL' | 'OLLAMA' | 'CUSTOM';
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createProvider(config: AIProviderConfig): any {
  switch (config.provider) {
    case 'ANTHROPIC': {
      const anthropic = createAnthropic({
        apiKey: config.apiKey,
        // Enable prompt caching — system prompts marked with cacheControl
        // will be cached server-side, reducing input token costs by ~90%
        cacheControl: true,
      });
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
      const deepseek = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.deepseek.com/v1',
      });
      return deepseek.chat(config.model);
    }
    case 'MISTRAL': {
      const mistral = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || 'https://api.mistral.ai/v1',
      });
      return mistral.chat(config.model);
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
