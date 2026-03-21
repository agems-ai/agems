import { spawn } from 'child_process';
import { BaseAdapter } from '../base-adapter';
import { AdapterResult, ClaudeCodeConfig } from '../types';

/**
 * Claude Code Adapter
 *
 * Integrates with Anthropic's Claude Code CLI tool.
 * Runs `claude` CLI as a subprocess, parses stdout for tool calls and output.
 */
export class ClaudeCodeAdapter extends BaseAdapter {
  protected override config: ClaudeCodeConfig;

  constructor(config: ClaudeCodeConfig) {
    super(config);
    this.config = config;
  }

  get name(): string {
    return 'Claude Code';
  }

  async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], { shell: true });
      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ available: true, version: output.trim() });
        } else {
          resolve({ available: false, error: 'Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code' });
        }
      });
      proc.on('error', () => {
        resolve({ available: false, error: 'Claude Code CLI not installed' });
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
      const args = [
        '--print',
        '--output-format', 'json',
      ];

      if (this.config.model) {
        args.push('--model', this.config.model);
      }

      if (this.config.maxTokens) {
        args.push('--max-tokens', String(this.config.maxTokens));
      }

      if (this.config.allowedTools?.length) {
        args.push('--allowedTools', this.config.allowedTools.join(','));
      }

      // Build full prompt with context
      let fullPrompt = input.prompt;
      if (input.context) {
        fullPrompt = `Context:\n${input.context}\n\nTask:\n${fullPrompt}`;
      }
      if (input.skills?.length) {
        fullPrompt = `Available skills: ${input.skills.join(', ')}\n\n${fullPrompt}`;
      }

      args.push(fullPrompt);

      const proc = spawn('claude', args, {
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

        let toolCalls: AdapterResult['toolCalls'];
        let output = stdout;
        let tokensUsed: number | undefined;
        let costUsd: number | undefined;

        // Try parsing JSON output
        try {
          const parsed = JSON.parse(stdout);
          output = parsed.result || parsed.text || stdout;
          toolCalls = parsed.tool_calls?.map((tc: any) => ({
            tool: tc.tool_name || tc.name,
            input: tc.tool_input || tc.input,
            output: tc.tool_result || tc.output,
          }));
          tokensUsed = parsed.usage?.total_tokens;
          costUsd = parsed.cost_usd;
        } catch {
          // Plain text output
        }

        this.setStatus(code === 0 ? 'succeeded' : 'failed');
        resolve(this.buildResult({
          success: code === 0,
          output,
          toolCalls,
          tokensUsed,
          costUsd,
          error: code !== 0 ? stderr || `Exit code: ${code}` : undefined,
          rawOutput: stdout,
        }));
      });

      proc.on('error', (err) => {
        this.setStatus('failed');
        resolve(this.buildResult({
          success: false,
          error: err.message,
          rawOutput: stdout,
        }));
      });
    });
  }
}
