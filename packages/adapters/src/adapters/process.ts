import { spawn } from 'child_process';
import { BaseAdapter } from '../base-adapter';
import { AdapterResult, ProcessConfig } from '../types';

/**
 * Process Adapter
 *
 * Generic adapter that runs any shell command as an agent.
 * Useful for custom scripts, local LLM wrappers, or any CLI tool.
 */
export class ProcessAdapter extends BaseAdapter {
  protected override config: ProcessConfig;

  private static readonly ALLOWED_COMMANDS = ['node', 'python', 'bash', 'sh'];

  constructor(config: ProcessConfig) {
    super(config);
    this.config = config;
  }

  get name(): string {
    return 'Process';
  }

  private getCommandParts(): { cmd: string; baseArgs: string[] } {
    if (!this.config.command) {
      throw new Error('Command not configured');
    }

    const parts = this.config.command.split(' ').filter(Boolean);
    const cmd = parts[0];
    const baseArgs = parts.slice(1);

    if (!ProcessAdapter.ALLOWED_COMMANDS.includes(cmd)) {
      throw new Error(`Command not allowed: ${cmd}`);
    }

    return { cmd, baseArgs };
  }

  async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const { cmd } = this.getCommandParts();

      return new Promise((resolve) => {
        const proc = spawn('which', [cmd]);
        let output = '';

        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ available: true, version: output.trim() });
          } else {
            resolve({ available: false, error: `Command not found: ${cmd}` });
          }
        });

        proc.on('error', () => {
          resolve({ available: false, error: `Cannot check command: ${cmd}` });
        });
      });
    } catch (err: any) {
      return { available: false, error: err.message };
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
    const abort = this.createAbortController();

    return new Promise((resolve) => {
      let cmd: string;
      let baseArgs: string[];

      try {
        const parts = this.getCommandParts();
        cmd = parts.cmd;
        baseArgs = parts.baseArgs;
      } catch (err: any) {
        this.setStatus('failed');
        resolve(this.buildResult({ success: false, error: err.message }));
        return;
      }

      const args = [...baseArgs, ...(this.config.args || [])];

      const proc = spawn(cmd, args, {
        cwd: this.config.workingDir || process.cwd(),
        env: {
          ...process.env,
          ...this.config.env,
          AGEMS_PROMPT: input.prompt,
          AGEMS_CONTEXT: input.context || '',
          AGEMS_TASK_ID: input.taskId || '',
          AGEMS_CHANNEL_ID: input.channelId || '',
        },
        signal: abort.signal,
      });

      // Send prompt via stdin
      if (proc.stdin) {
        proc.stdin.write(input.prompt);
        proc.stdin.end();
      }

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
