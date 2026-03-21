import { spawn } from 'child_process';
import { BaseAdapter } from '../base-adapter';
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
    return new Promise((resolve) => {
      const proc = spawn('codex', ['--version'], { shell: true });
      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ available: true, version: output.trim() });
        } else {
          resolve({ available: false, error: 'Codex CLI not found. Install: npm install -g @openai/codex' });
        }
      });
      proc.on('error', () => {
        resolve({ available: false, error: 'Codex CLI not installed' });
      });
    });
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
        args.push(`--approval-mode`, this.config.approvalMode);
      }

      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      let fullPrompt = input.prompt;
      if (input.context) {
        fullPrompt = `Context:\n${input.context}\n\nTask:\n${fullPrompt}`;
      }

      args.push(fullPrompt);

      const proc = spawn('codex', args, {
        cwd: this.config.workingDir || process.cwd(),
        env: { ...process.env, ...this.config.env },
        shell: true,
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
