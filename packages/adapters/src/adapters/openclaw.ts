import { BaseAdapter } from '../base-adapter';
import { AdapterResult, OpenClawConfig } from '../types';

/**
 * OpenClaw Adapter
 *
 * Connects to OpenClaw agent via SSE gateway.
 * OpenClaw runs in Docker and communicates via Server-Sent Events.
 */
export class OpenClawAdapter extends BaseAdapter {
  protected override config: OpenClawConfig;

  constructor(config: OpenClawConfig) {
    super(config);
    this.config = config;
  }

  get name(): string {
    return 'OpenClaw';
  }

  async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
    if (!this.config.gatewayUrl) {
      return { available: false, error: 'Gateway URL not configured' };
    }

    try {
      const res = await fetch(`${this.config.gatewayUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({} as any));
        return { available: true, version: (data as any).version || 'unknown' };
      }
      return { available: false, error: `Gateway returned ${res.status}` };
    } catch (err: any) {
      return { available: false, error: `Cannot reach gateway: ${err.message}` };
    }
  }

  async execute(input: {
    prompt: string;
    taskId?: string;
    channelId?: string;
    context?: string;
    skills?: string[];
  }): Promise<AdapterResult> {
    this.startTime = Date.now();
    this.setStatus('running');

    if (!this.config.gatewayUrl) {
      this.setStatus('failed');
      return this.buildResult({ success: false, error: 'Gateway URL not configured' });
    }

    try {
      const abort = this.createAbortController();

      let fullPrompt = input.prompt;
      if (input.context) {
        fullPrompt = `Context:\n${input.context}\n\nTask:\n${fullPrompt}`;
      }

      // Send task to OpenClaw gateway via SSE
      const res = await fetch(`${this.config.gatewayUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fullPrompt,
          taskId: input.taskId,
          container: this.config.containerName,
        }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        this.setStatus('failed');
        return this.buildResult({ success: false, error: `Gateway error: ${errText}` });
      }

      // Read SSE stream
      let output = '';
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          output += chunk;
          this.emit('output', chunk);
        }
      } else {
        output = await res.text();
      }

      this.setStatus('succeeded');
      return this.buildResult({ success: true, output, rawOutput: output });
    } catch (err: any) {
      if (this.status === 'cancelled' || this.status === 'timed_out') {
        return this.buildResult({ success: false, error: this.status });
      }
      this.setStatus('failed');
      return this.buildResult({ success: false, error: err.message });
    }
  }
}
