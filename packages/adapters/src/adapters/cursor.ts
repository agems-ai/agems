import { BaseAdapter } from '../base-adapter';
import { spawnCli, checkCliVersion, safePromptArg } from '../safe-spawn';
import { AdapterResult, CursorConfig } from '../types';

/**
 * Cursor IDE Agent Adapter
 *
 * Integrates with Cursor's CLI agent mode.
 */
export class CursorAdapter extends BaseAdapter {
  protected override config: CursorConfig;

  constructor(config: CursorConfig) {
    super(config);
    this.config = config;
  }

  get name(): string {
    return 'Cursor';
  }

  async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
    return checkCliVersion('cursor', 'Cursor CLI not found. Install Cursor IDE from cursor.com');
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
      const args = ['--agent'];

      if (this.config.background) {
        args.push('--background');
      }

      let fullPrompt = input.prompt;
      if (input.context) {
        fullPrompt = `Context:\n${input.context}\n\nTask:\n${fullPrompt}`;
      }
      args.push(safePromptArg(fullPrompt));

      const proc = spawnCli('cursor', args, {
        cwd: this.config.workspacePath || this.config.workingDir || process.cwd(),
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
