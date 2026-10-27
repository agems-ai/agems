import { BaseAdapter } from '../base-adapter';
import { spawnCli, checkCliVersion, safePromptArg, safeOptionValue } from '../safe-spawn';
import { AdapterResult, OpenCodeConfig } from '../types';

/**
 * OpenCode Adapter
 *
 * Integrates with OpenCode AI agent CLI.
 */
export class OpenCodeAdapter extends BaseAdapter {
  protected override config: OpenCodeConfig;

  constructor(config: OpenCodeConfig) {
    super(config);
    this.config = config;
  }

  get name(): string {
    return 'OpenCode';
  }

  async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
    return checkCliVersion('opencode', 'OpenCode CLI not found');
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
    const abort = this.createAbortController();

    return new Promise((resolve) => {
      const args: string[] = [];

      if (this.config.model) {
        args.push('--model', safeOptionValue(this.config.model, 'model'));
      }
      if (this.config.provider) {
        args.push('--provider', safeOptionValue(this.config.provider, 'provider'));
      }

      let fullPrompt = input.prompt;
      if (input.context) {
        fullPrompt = `Context:\n${input.context}\n\nTask:\n${fullPrompt}`;
      }
      args.push(safePromptArg(fullPrompt));

      const proc = spawnCli('opencode', args, {
        cwd: this.config.workingDir || process.cwd(),
        env: this.config.env,
        signal: abort.signal,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        this.emit('output', chunk);
      });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (this.status === 'cancelled' || this.status === 'timed_out') {
          resolve(this.buildResult({ success: false, error: this.status, rawOutput: stdout }));
          return;
        }
        this.setStatus(code === 0 ? 'succeeded' : 'failed');
        resolve(this.buildResult({
          success: code === 0,
          output: stdout,
          error: code !== 0 ? stderr || `Exit code: ${code}` : undefined,
          rawOutput: stdout,
        }));
      });

      proc.on('error', (err) => {
        this.setStatus('failed');
        resolve(this.buildResult({ success: false, error: err.message }));
      });
    });
  }
}
