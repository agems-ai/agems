/**
 * External adapters must not turn a prompt or a config value into a command on the API host, must not hand the
 * API process environment (provider keys, DATABASE_URL, JWT and encryption secrets) to the child CLI, and must
 * only be reachable by a platform admin with ADAPTERS_ENABLED=true.
 *
 * A fake CLI (a shell script named claude, codex, ... first in PATH) prints each argv element and its env, so
 * the tests see exactly what the adapter passed. Run with:
 *   cd apps/api && npx tsx --test src/modules/adapters/adapters.security.spec.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AdapterFactory,
  AdapterConfigError,
  buildChildEnv,
  assertPublicHttpUrl,
  safePromptArg,
  OpenClawAdapter,
  HttpAdapter,
} from '@agems/adapters';
import { AdaptersService, platformAdminEmails, adaptersEnabled } from './adapters.service';
import { AdaptersController } from './adapters.controller';

const SECRETS: Record<string, string> = {
  DATABASE_URL: 'postgresql://agems:db-sentinel-7f3a@postgres:5432/agems',
  JWT_SECRET: 'jwt-sentinel-91c2',
  CREDENTIALS_KEY: 'credkey-sentinel-55aa',
  ANTHROPIC_API_KEY: 'sk-ant-platform-sentinel',
  OPENAI_API_KEY: 'sk-openai-platform-sentinel',
  GOOGLE_AI_API_KEY: 'AIza-platform-sentinel',
  STRIPE_SECRET_KEY: 'sk_live_stripe-sentinel',
};
const CLI_TYPES: Array<[string, string]> = [
  ['CLAUDE_CODE', 'claude'],
  ['CODEX', 'codex'],
  ['CURSOR', 'cursor'],
  ['GEMINI_CLI', 'gemini'],
  ['OPENCODE', 'opencode'],
  ['PI', 'pi'],
];

let tmp = '';
let binDir = '';
const saved: Record<string, string | undefined> = {};

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agems-adapters-'));
  binDir = path.join(tmp, 'bin');
  fs.mkdirSync(binDir);
  const script = [
    '#!/bin/sh',
    'for a in "$@"; do printf "ARG<%s>\\n" "$a"; done',
    'env | sed "s/^/ENV /"',
  ].join('\n') + '\n';
  for (const [, cli] of CLI_TYPES) {
    fs.writeFileSync(path.join(binDir, cli), script, { mode: 0o755 });
  }
  for (const name of [...Object.keys(SECRETS), 'PATH', 'ADAPTERS_ENABLED', 'PLATFORM_ADMIN_EMAILS']) saved[name] = process.env[name];
  Object.assign(process.env, SECRETS);
  process.env.PATH = `${binDir}:${process.env.PATH}`;
});

after(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function assertNoSecrets(text: string) {
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!text.includes(value), `${name} leaked to the child process`);
  }
}

describe('CLI adapters: no shell, no inherited secrets', () => {
  for (const [type, cli] of CLI_TYPES) {
    it(`${type} passes a shell payload as one plain argument and leaks no platform env`, async () => {
      const markers = [1, 2, 3, 4].map((i) => path.join(tmp, `${cli}-pwned-${i}`));
      const prompt = `x; touch ${markers[0]}; echo $(touch ${markers[1]}) \`touch ${markers[2]}\` && touch ${markers[3]} | env > /dev/null`;
      const adapter = AdapterFactory.create(type as any, { workingDir: tmp });
      const result = await adapter.execute({ prompt });

      assert.equal(result.success, true, result.error);
      for (const m of markers) assert.equal(fs.existsSync(m), false, `shell ran: ${m}`);
      assert.ok(result.rawOutput!.includes(`ARG<${prompt}>`), 'prompt must arrive as exactly one argv element');
      assertNoSecrets(result.rawOutput!);
      assert.match(result.rawOutput!, /^ENV PATH=/m, 'PATH is kept so the CLI can start');
    });
  }

  it('availability runs `<cli> --version` without a shell or secrets', async () => {
    const res = await AdapterFactory.check('CLAUDE_CODE', {});
    assert.equal(res.available, true);
    assert.match(res.version || '', /ARG<--version>/);
    assertNoSecrets(res.version || '');
  });

  it('a prompt that looks like an option stays a positional argument', async () => {
    const adapter = AdapterFactory.create('CLAUDE_CODE', { workingDir: tmp });
    const result = await adapter.execute({ prompt: '--dangerously-skip-permissions' });
    assert.ok(result.rawOutput!.includes('ARG< --dangerously-skip-permissions>'));
    assert.ok(!result.rawOutput!.includes('ARG<--dangerously-skip-permissions>'));
    assert.equal(safePromptArg('-p'), ' -p');
  });

  it('the adapter env reaches the child, the platform value of the same name does not', async () => {
    const adapter = AdapterFactory.create('CLAUDE_CODE', { workingDir: tmp, env: { ANTHROPIC_API_KEY: 'user-own-key' } });
    const result = await adapter.execute({ prompt: 'hello' });
    assert.match(result.rawOutput!, /^ENV ANTHROPIC_API_KEY=user-own-key$/m);
    assertNoSecrets(result.rawOutput!);
  });
});

describe('adapter config validation', () => {
  const badValues = ['x; env', '$(id)', '`id`', 'a b', '--help', '-m', 'a|b', 'a&&b', 'a\nb', '>/tmp/x', "a'b", 'a"b', ''.padEnd(200, 'a')];

  for (const field of ['model', 'provider'] as const) {
    it(`rejects shell or option syntax in ${field}`, () => {
      for (const value of badValues) {
        assert.throws(() => AdapterFactory.create('OPENCODE', { [field]: value }), AdapterConfigError, `${field}=${JSON.stringify(value)}`);
      }
    });
  }

  it('accepts real model ids', () => {
    for (const model of ['claude-sonnet-5-5', 'openai/gpt-6-luna', 'gemini-3.5-flash', 'anthropic:claude-haiku-5-5', 'deepseek-flash']) {
      assert.doesNotThrow(() => AdapterFactory.create('CLAUDE_CODE', { model }), model);
    }
  });

  it('rejects env variables that run code in the child, bad names and non-string values', () => {
    for (const name of ['NODE_OPTIONS', 'LD_PRELOAD', 'ld_preload', 'BASH_ENV', 'ENV', 'PATH', 'GIT_SSH_COMMAND', 'PYTHONSTARTUP', 'DYLD_INSERT_LIBRARIES', 'NPM_CONFIG_SCRIPT_SHELL', 'BASH_FUNC_x%%']) {
      assert.throws(() => AdapterFactory.create('CLAUDE_CODE', { env: { [name]: 'x' } }), AdapterConfigError, name);
    }
    assert.throws(() => AdapterFactory.create('CLAUDE_CODE', { env: { 'A B': 'x' } }), AdapterConfigError);
    assert.throws(() => AdapterFactory.create('CLAUDE_CODE', { env: { __proto__x: 'x' } }), AdapterConfigError);
    assert.throws(() => AdapterFactory.create('CLAUDE_CODE', { env: { OK: 1 as any } }), AdapterConfigError);
    assert.throws(() => AdapterFactory.create('CLAUDE_CODE', { env: 'A=1' as any }), AdapterConfigError);
  });

  it('rejects bad maxTokens, allowedTools, approvalMode and relative workingDir', () => {
    assert.throws(() => AdapterFactory.create('CLAUDE_CODE', { maxTokens: '1; env' as any }), AdapterConfigError);
    assert.throws(() => AdapterFactory.create('CLAUDE_CODE', { allowedTools: ['Read', 'Bash; env'] }), AdapterConfigError);
    assert.doesNotThrow(() => AdapterFactory.create('CLAUDE_CODE', { allowedTools: ['Read', 'Bash(git:*)', 'mcp__srv__tool'] }));
    assert.throws(() => AdapterFactory.create('CODEX', { approvalMode: 'full-auto; env' as any }), AdapterConfigError);
    assert.throws(() => AdapterFactory.create('CLAUDE_CODE', { workingDir: '../etc' }), AdapterConfigError);
  });

  it('buildChildEnv copies only allowlisted host variables', () => {
    const env = buildChildEnv({ MY_TOOL_TOKEN: 't' }, { PATH: '/bin', HOME: '/root', ...SECRETS, REDIS_URL: 'redis://x' });
    assert.deepEqual(Object.keys(env).sort(), ['HOME', 'MY_TOOL_TOKEN', 'PATH']);
  });
});

describe('URL adapters never reach internal addresses', () => {
  const internal = [
    'http://127.0.0.1:3001/api/settings',
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://postgres:5432/',
    'http://arm-postgres-1/',
    'http://10.0.0.5/',
    'http://172.17.0.1/',
    'http://192.168.1.1/',
    'http://100.100.100.200/',
    'http://metadata.google.internal/',
    'file:///etc/passwd',
    'gopher://example.com/',
  ];
  it('assertPublicHttpUrl rejects loopback, metadata, private, container and non-http targets', () => {
    for (const url of internal) assert.throws(() => assertPublicHttpUrl(url), AdapterConfigError, url);
    assert.equal(assertPublicHttpUrl('https://hooks.example.com/run'), 'https://hooks.example.com/run');
  });

  it('HTTP and OpenClaw availability refuse internal targets before any request', async () => {
    const http = await new HttpAdapter({ url: 'http://127.0.0.1:1/' }).checkAvailability();
    assert.equal(http.available, false);
    assert.match(http.error || '', /local or private/);
    const claw = await new OpenClawAdapter({ gatewayUrl: 'http://169.254.169.254/#' }).checkAvailability();
    assert.equal(claw.available, false);
    assert.match(claw.error || '', /local or private/);
  });
});

// ── Service and controller access ──

const ADMIN_ID = 'u-platform';
const SIGNUP_ID = 'u-signup';
function fakePrisma() {
  const users: Record<string, { email: string }> = {
    [ADMIN_ID]: { email: 'Ops@Example.com' },
    [SIGNUP_ID]: { email: 'attacker@example.net' },
  };
  return {
    user: { findUnique: async ({ where }: any) => users[where.id] ?? null },
    agent: { findUnique: async () => null },
  } as any;
}
function service() {
  return new AdaptersService(fakePrisma(), { emit: () => true } as any);
}

describe('AdaptersService.assertAccess', () => {
  it('is off unless ADAPTERS_ENABLED=true, even for a platform admin', async () => {
    delete process.env.ADAPTERS_ENABLED;
    process.env.PLATFORM_ADMIN_EMAILS = 'ops@example.com';
    await assert.rejects(service().assertAccess(ADMIN_ID), ForbiddenException);
    process.env.ADAPTERS_ENABLED = 'false';
    await assert.rejects(service().assertAccess(ADMIN_ID), ForbiddenException);
    assert.equal(adaptersEnabled('TRUE'), true);
    assert.equal(adaptersEnabled('1'), false);
  });

  it('refuses everybody when PLATFORM_ADMIN_EMAILS is empty', async () => {
    process.env.ADAPTERS_ENABLED = 'true';
    process.env.PLATFORM_ADMIN_EMAILS = ' , ';
    assert.deepEqual(platformAdminEmails(), []);
    await assert.rejects(service().assertAccess(ADMIN_ID), ForbiddenException);
  });

  it('refuses a self-registered org ADMIN and allows a listed platform admin (case-insensitive)', async () => {
    process.env.ADAPTERS_ENABLED = 'true';
    process.env.PLATFORM_ADMIN_EMAILS = 'someone@else.com, ops@example.com';
    await assert.rejects(service().assertAccess(SIGNUP_ID), ForbiddenException);
    await assert.rejects(service().assertAccess(undefined), ForbiddenException);
    await assert.rejects(service().assertAccess('missing'), ForbiddenException);
    await service().assertAccess(ADMIN_ID);
  });
});

describe('AdaptersService.execute', () => {
  it('never runs PROCESS, HTTP or OPENCLAW from the endpoint', async () => {
    for (const type of ['PROCESS', 'HTTP', 'OPENCLAW']) {
      await assert.rejects(service().execute(type, 'hi', { userId: ADMIN_ID, orgId: 'o' }), ForbiddenException, type);
    }
  });

  it('turns injection in config or an unknown type into 400, and runs nothing', async () => {
    const marker = path.join(tmp, 'svc-pwned');
    await assert.rejects(
      service().execute('CLAUDE_CODE', 'hi', { config: { model: `x; touch ${marker}` }, userId: ADMIN_ID, orgId: 'o' }),
      BadRequestException,
    );
    await assert.rejects(service().execute('claude_code; env', 'hi', { userId: ADMIN_ID, orgId: 'o' }), BadRequestException);
    await assert.rejects(service().execute('CLAUDE_CODE', '', { userId: ADMIN_ID, orgId: 'o' }), BadRequestException);
    await assert.rejects(service().execute('CLAUDE_CODE', 'hi', { config: [] as any, userId: ADMIN_ID, orgId: 'o' }), BadRequestException);
    assert.equal(fs.existsSync(marker), false);
  });

  it('availability takes no caller config (no probe of a caller-chosen URL)', async () => {
    assert.equal(service().checkAvailability.length, 1);
    const res = await service().checkAvailability('HTTP');
    assert.equal(res.available, false);
  });
});

describe('AdaptersController', () => {
  it('checks access before availability or execute reaches the service', async () => {
    process.env.ADAPTERS_ENABLED = 'true';
    process.env.PLATFORM_ADMIN_EMAILS = 'ops@example.com';
    const svc = service();
    const calls: string[] = [];
    for (const m of ['checkAllAvailability', 'checkAvailability', 'execute', 'executeForAgent'] as const) {
      (svc as any)[m] = async () => { calls.push(m); return {}; };
    }
    const controller = new AdaptersController(svc);
    const req = { user: { id: SIGNUP_ID, orgId: 'o', role: 'ADMIN' } as any };
    await assert.rejects(controller.checkAllAvailability(req), ForbiddenException);
    await assert.rejects(controller.checkAvailability('CLAUDE_CODE', req), ForbiddenException);
    await assert.rejects(controller.execute('CLAUDE_CODE', { prompt: 'x; env' }, req), ForbiddenException);
    await assert.rejects(controller.executeForAgent('a1', { prompt: 'x; env' }, req), ForbiddenException);
    assert.deepEqual(calls, []);

    const adminReq = { user: { id: ADMIN_ID, orgId: 'o', role: 'ADMIN' } as any };
    await controller.execute('CLAUDE_CODE', { prompt: 'ok' }, adminReq);
    assert.deepEqual(calls, ['execute']);
  });
});
