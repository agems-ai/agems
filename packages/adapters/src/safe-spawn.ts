import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';

/**
 * Safe process and network helpers for external agent adapters.
 *
 * Adapters run third-party agent CLIs on the API host. Two rules keep a prompt or a config value from turning
 * into a command on the host or a leak of platform secrets:
 * 1. Never go through a shell. Every CLI is started with shell:false and an argv array, so `x; env`,
 *    `$(id)` or backticks stay plain text inside one argument.
 * 2. Never inherit the API process environment. The child gets a short allowlist of host variables
 *    (PATH, HOME, locale) plus the adapter's own validated `env`; provider keys, DATABASE_URL, JWT and
 *    encryption secrets never reach it.
 * Every value that becomes an argv element is validated, and a prompt can never be read as an option.
 */

export class AdapterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterConfigError';
  }
}

/** Host variables a CLI needs to start. Nothing else from the API process environment reaches the child. */
export const CHILD_ENV_ALLOWLIST: readonly string[] = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TZ', 'USER'];

const ENV_NAME = /^(?!__)[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Variables that change how a runtime, loader or shell starts: setting them is code execution in the child. */
const BLOCKED_ENV_EXACT = new Set([
  'PATH', 'HOME', 'IFS', 'ENV', 'BASH_ENV', 'PS4', 'PROMPT_COMMAND', 'SHELLOPTS', 'BASHOPTS',
  'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME', 'PYTHONINSPECT', 'PERL5OPT', 'PERL5LIB', 'PERLLIB',
  'RUBYOPT', 'RUBYLIB', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'GCONV_PATH',
  'HOSTALIASES', 'LOCALDOMAIN', 'RES_OPTIONS', 'SSLKEYLOGFILE', 'EDITOR', 'VISUAL', 'PAGER',
]);
const BLOCKED_ENV_PREFIX = ['LD_', 'DYLD_', 'NODE_', 'NPM_CONFIG_', 'GIT_', 'BASH_FUNC_', 'ELECTRON_', 'BUN_', 'DENO_'];
const MAX_ENV_VALUE = 16 * 1024;

/**
 * Environment for a child CLI: allowlisted host variables plus validated adapter-specific variables.
 * `base` is the API process environment; only CHILD_ENV_ALLOWLIST names are copied from it.
 */
export function buildChildEnv(extra?: unknown, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    const value = base[name];
    if (typeof value === 'string') env[name] = value;
  }
  for (const [name, value] of Object.entries(validateEnv(extra))) env[name] = value;
  return env;
}

/** Validates an adapter `env` object (names, blocked loader variables, string values). */
export function validateEnv(extra: unknown): Record<string, string> {
  if (extra === undefined || extra === null) return {};
  if (typeof extra !== 'object' || Array.isArray(extra)) throw new AdapterConfigError('env must be an object of string values');
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(extra as Record<string, unknown>)) {
    if (!ENV_NAME.test(name)) throw new AdapterConfigError(`Invalid env variable name: ${name.slice(0, 64)}`);
    const upper = name.toUpperCase();
    if (BLOCKED_ENV_EXACT.has(upper) || BLOCKED_ENV_PREFIX.some((p) => upper.startsWith(p))) {
      throw new AdapterConfigError(`env variable ${name} is not allowed`);
    }
    if (typeof value !== 'string' || value.includes('\0') || value.length > MAX_ENV_VALUE) {
      throw new AdapterConfigError(`env variable ${name} must be a string of at most ${MAX_ENV_VALUE} characters`);
    }
    out[name] = value;
  }
  return out;
}

const OPTION_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;

/** A value passed after an option such as --model or --provider: one token, no spaces or shell syntax, never an option. */
export function safeOptionValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || !OPTION_VALUE.test(value)) {
    throw new AdapterConfigError(`Invalid ${field}: use letters, digits and . _ : / @ + - (max 128, not starting with -)`);
  }
  return value;
}

export function safeEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AdapterConfigError(`Invalid ${field}: expected one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function safePositiveInt(value: unknown, field: string, max = 1_000_000): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max) {
    throw new AdapterConfigError(`Invalid ${field}: expected an integer from 1 to ${max}`);
  }
  return n;
}

/** Tool names for --allowedTools, e.g. Read, Bash(git:*), mcp__server__tool. */
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,127}(\([A-Za-z0-9 _:*./-]{0,128}\))?$/;

export function safeToolList(value: unknown, field = 'allowedTools'): string[] {
  if (!Array.isArray(value) || value.length > 100 || !value.every((t) => typeof t === 'string' && TOOL_NAME.test(t))) {
    throw new AdapterConfigError(`Invalid ${field}`);
  }
  return value as string[];
}

export const MAX_PROMPT_CHARS = 100_000;

/**
 * The prompt as a single positional argument. A leading dash would be parsed as an option by the CLI
 * (for example "--dangerously-skip-permissions"), so such prompts get a leading space.
 */
export function safePromptArg(prompt: unknown): string {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new AdapterConfigError('prompt is required');
  if (prompt.includes('\0')) throw new AdapterConfigError('prompt must not contain NUL bytes');
  if (prompt.length > MAX_PROMPT_CHARS) throw new AdapterConfigError(`prompt is longer than ${MAX_PROMPT_CHARS} characters`);
  return prompt.startsWith('-') ? ` ${prompt}` : prompt;
}

export function safeWorkingDir(dir: unknown): string {
  if (dir === undefined || dir === null || dir === '') return process.cwd();
  if (typeof dir !== 'string' || dir.includes('\0') || dir.length > 1024 || !path.isAbsolute(dir)) {
    throw new AdapterConfigError('workingDir must be an absolute path');
  }
  return path.normalize(dir);
}

const CLI_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** Starts a CLI without a shell and without the API process environment. */
export function spawnCli(
  command: string,
  args: string[],
  options: { cwd?: unknown; env?: unknown; signal?: AbortSignal; extraEnv?: Record<string, string> } = {},
): ChildProcessWithoutNullStreams {
  if (!CLI_NAME.test(command)) throw new AdapterConfigError(`Invalid CLI name: ${command}`);
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.includes('\0')) throw new AdapterConfigError('Invalid CLI argument');
  }
  const env = { ...buildChildEnv(options.env), ...(options.extraEnv || {}) };
  return spawn(command, args, {
    cwd: safeWorkingDir(options.cwd),
    env,
    shell: false,
    windowsHide: true,
    signal: options.signal,
  });
}

/** `<cli> --version` without a shell; the CLI name is a constant of each adapter, never config. */
export function checkCliVersion(command: string, notFound: string): Promise<{ available: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawnCli(command, ['--version']);
    } catch (err: any) {
      resolve({ available: false, error: err.message });
      return;
    }
    let output = '';
    proc.stdout?.on('data', (data) => { output += data.toString(); });
    proc.on('close', (code) => {
      resolve(code === 0 ? { available: true, version: output.trim().slice(0, 200) } : { available: false, error: notFound });
    });
    proc.on('error', () => resolve({ available: false, error: notFound }));
  });
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[')) return true; // IPv6 literals are not accepted
  if (!host.includes('.')) return true; // single-label names resolve to containers and LAN hosts
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  return false;
}

/** http(s) URL that does not point at loopback, link-local (cloud metadata), private or container-internal hosts. */
export function assertPublicHttpUrl(value: unknown, field = 'url'): string {
  if (typeof value !== 'string' || value.length > 2048) throw new AdapterConfigError(`Invalid ${field}`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AdapterConfigError(`Invalid ${field}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new AdapterConfigError(`${field} must be http or https`);
  if (isBlockedHost(parsed.hostname)) throw new AdapterConfigError(`${field} points to a local or private network address`);
  return parsed.toString();
}

/**
 * Validates the config fields shared by adapters. Called by every adapter constructor, so a bad value fails
 * before anything runs. Unknown keys are ignored by the adapters.
 */
export function validateAdapterConfig(config: Record<string, unknown>): void {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new AdapterConfigError('config must be an object');
  validateEnv(config.env);
  if (config.workingDir !== undefined) safeWorkingDir(config.workingDir);
  if (config.workspacePath !== undefined) safeWorkingDir(config.workspacePath);
  if (config.timeoutMs !== undefined) safePositiveInt(config.timeoutMs, 'timeoutMs', 24 * 60 * 60 * 1000);
  if (config.model !== undefined && config.model !== '') safeOptionValue(config.model, 'model');
  if (config.provider !== undefined && config.provider !== '') safeOptionValue(config.provider, 'provider');
  if (config.maxTokens !== undefined) safePositiveInt(config.maxTokens, 'maxTokens');
  if (config.allowedTools !== undefined) safeToolList(config.allowedTools);
  if (config.approvalMode !== undefined) safeEnum(config.approvalMode, ['suggest', 'auto-edit', 'full-auto'] as const, 'approvalMode');
}
