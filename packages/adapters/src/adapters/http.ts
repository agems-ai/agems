import { BaseAdapter } from '../base-adapter';
import { AdapterResult, HttpAdapterConfig } from '../types';

/**
 * HTTP Webhook Adapter
 *
 * Generic adapter that sends tasks to any HTTP endpoint.
 * Supports fire-and-forget or wait-for-response modes.
 */
export class HttpAdapter extends BaseAdapter {
  protected override config: HttpAdapterConfig;

  constructor(config: HttpAdapterConfig) {
    super(config);
    this.config = config;
  }

  get name(): string {
    return 'HTTP Webhook';
  }

  async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
    if (!this.config.url) {
      return { available: false, error: 'Webhook URL not configured' };
    }

    try {
      const res = await fetch(this.config.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      return { available: true, version: `HTTP ${res.status}` };
    } catch (err: any) {
      // HEAD might not be supported, try OPTIONS
      try {
        const res = await fetch(this.config.url, {
          method: 'OPTIONS',
          signal: AbortSignal.timeout(5000),
        });
        return { available: true, version: `HTTP ${res.status}` };
      } catch {
        return { available: false, error: `Cannot reach endpoint: ${err.message}` };
      }
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

    if (!this.config.url) {
      this.setStatus('failed');
      return this.buildResult({ success: false, error: 'Webhook URL not configured' });
    }

    try {
      const abort = this.createAbortController();

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.config.headers,
      };

      // Add authentication
      if (this.config.auth) {
        switch (this.config.auth.type) {
          case 'bearer':
            headers['Authorization'] = `Bearer ${this.config.auth.token}`;
            break;
          case 'basic':
            const creds = Buffer.from(`${this.config.auth.username}:${this.config.auth.password}`).toString('base64');
            headers['Authorization'] = `Basic ${creds}`;
            break;
          case 'api_key':
            headers[this.config.auth.headerName || 'X-API-Key'] = this.config.auth.apiKey || '';
            break;
        }
      }

      const body = JSON.stringify({
        prompt: input.prompt,
        context: input.context,
        taskId: input.taskId,
        channelId: input.channelId,
        skills: input.skills,
      });

      const res = await fetch(this.config.url, {
        method: this.config.method || 'POST',
        headers,
        body,
        signal: abort.signal,
      });

      if (!this.config.waitForResponse) {
        // Fire-and-forget
        this.setStatus('succeeded');
        return this.buildResult({
          success: res.ok,
          output: `Request sent. Status: ${res.status}`,
          rawOutput: `HTTP ${res.status} ${res.statusText}`,
        });
      }

      // Wait for response
      const responseText = await res.text();
      let output = responseText;

      try {
        const parsed = JSON.parse(responseText);
        output = parsed.output || parsed.result || parsed.text || responseText;
      } catch {
        // Plain text response
      }

      this.setStatus(res.ok ? 'succeeded' : 'failed');
      return this.buildResult({
        success: res.ok,
        output,
        error: !res.ok ? `HTTP ${res.status}: ${responseText.substring(0, 500)}` : undefined,
        rawOutput: responseText,
      });
    } catch (err: any) {
      if (this.status === 'cancelled' || this.status === 'timed_out') {
        return this.buildResult({ success: false, error: this.status });
      }
      this.setStatus('failed');
      return this.buildResult({ success: false, error: err.message });
    }
  }
}
