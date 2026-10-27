import { BaseAdapter } from '../base-adapter';
import { spawnCli, checkCliVersion, safePromptArg, safeOptionValue, safePositiveInt, safeToolList } from '../safe-spawn';
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
    return checkCliVersion('claude', 'Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code');
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
        args.push('--model', safeOptionValue(this.config.model, 'model'));
      }

      if (this.config.maxTokens) {
        args.push('--max-tokens', String(safePositiveInt(this.config.maxTokens, 'maxTokens')));
      }

      if (this.config.allowedTools?.length) {
        args.push('--allowedTools', safeToolList(this.config.allowedTools).join(','));
      }

      // Build full prompt with context
      let fullPrompt = input.prompt;
      if (input.context) {
        fullPrompt = `Context:\n${input.context}\n\nTask:\n${fullPrompt}`;
      }
      if (input.skills?.length) {
        fullPrompt = `Available skills: ${input.skills.join(', ')}\n\n${fullPrompt}`;
      }

      args.push(safePromptArg(fullPrompt));

      const proc = spawnCli('claude', args, {
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
