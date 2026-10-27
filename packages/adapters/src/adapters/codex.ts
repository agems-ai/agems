import { BaseAdapter } from '../base-adapter';
import { spawnCli, checkCliVersion, safePromptArg, safeOptionValue, safeEnum } from '../safe-spawn';
import { AdapterResult, CodexConfig } from '../types';

/**
 * OpenAI Codex CLI Adapter
 *
 * Integrates with OpenAI's Codex CLI tool.
 */
export class CodexAdapter extends BaseAdapter {
  protected override config: CodexConfig;

  constructor(config: CodexConfig) {
    super(config);
    this.config = config;
  }

  get name(): string {
    return 'OpenAI Codex';
  }

  async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
    return checkCliVersion('codex', 'Codex CLI not found. Install: npm install -g @openai/codex');
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

      if (this.config.approvalMode) {
        args.push('--approval-mode', safeEnum(this.config.approvalMode, ['suggest', 'auto-edit', 'full-auto'] as const, 'approvalMode'));
      }

      if (this.config.model) {
        args.push('--model', safeOptionValue(this.config.model, 'model'));
      }

      let fullPrompt = input.prompt;
      if (input.context) {
        fullPrompt = `Context:\n${input.context}\n\nTask:\n${fullPrompt}`;
      }

      args.push(safePromptArg(fullPrompt));

      const proc = spawnCli('codex', args, {
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

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

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
