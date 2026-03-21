import { EventEmitter } from 'events';
import { AdapterConfig, AdapterResult, AdapterRunStatus, AdapterEvents } from './types';

/**
 * Base class for all external agent adapters.
 * Provides common lifecycle management, event emission, and timeout handling.
 */
export abstract class BaseAdapter extends EventEmitter {
  protected config: AdapterConfig;
  protected status: AdapterRunStatus = 'queued';
  protected abortController: AbortController | null = null;
  protected startTime: number = 0;

  constructor(config: AdapterConfig) {
    super();
    this.config = {
      timeoutMs: 30 * 60 * 1000, // 30 minutes default
      ...config,
    };
  }

  /** Human-readable adapter name */
  abstract get name(): string;

  /** Check if the external agent runtime is installed/available */
  abstract checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }>;

  /** Execute a task/prompt via the external agent */
  abstract execute(input: {
    prompt: string;
    taskId?: string;
    channelId?: string;
    context?: string;
    skills?: string[];
  }): Promise<AdapterResult>;

  /** Cancel a running execution */
  async cancel(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.setStatus('cancelled');
  }

  protected setStatus(status: AdapterRunStatus): void {
    this.status = status;
    this.emit('status', status);
  }

  protected createAbortController(): AbortController {
    this.abortController = new AbortController();

    if (this.config.timeoutMs) {
      setTimeout(() => {
        if (this.status === 'running') {
          this.abortController?.abort();
          this.setStatus('timed_out');
        }
      }, this.config.timeoutMs);
    }

    return this.abortController;
  }

  protected buildResult(partial: Partial<AdapterResult>): AdapterResult {
    return {
      success: partial.success ?? false,
      output: partial.output ?? '',
      toolCalls: partial.toolCalls,
      tokensUsed: partial.tokensUsed,
      costUsd: partial.costUsd,
      error: partial.error,
      rawOutput: partial.rawOutput,
      durationMs: Date.now() - this.startTime,
    };
  }

  /** Override EventEmitter typing */
  override on<K extends keyof AdapterEvents>(event: K, listener: AdapterEvents[K]): this {
    return super.on(event, listener as (...args: any[]) => void);
  }

  override emit<K extends keyof AdapterEvents>(event: K, ...args: Parameters<AdapterEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}
