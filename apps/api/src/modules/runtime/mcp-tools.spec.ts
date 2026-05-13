/**
 * Unit tests for the AGEMS MCP tool catalog.
 *
 * If these break, external Claude Code / Cursor sessions hit AGEMS and
 * either crash, return the wrong data, or worse — bypass the orgId
 * gate and see another tenant's data. Always-validate-orgId is a
 * security invariant tested here.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildToolCatalog, type McpPrisma } from './mcp-tools';

function makeFakePrisma(state: {
  channels?: any[]; messages?: any[]; tasks?: any[]; agents?: any[];
} = {}): McpPrisma & { _state: typeof state; _calls: Record<string, any[]> } {
  const _calls: Record<string, any[]> = {};
  const record = (key: string, args: any) => {
    _calls[key] = _calls[key] ?? [];
    _calls[key].push(args);
  };
  const channels = state.channels ?? [];
  const messages = state.messages ?? [];
  const tasks = state.tasks ?? [];
  const agents = state.agents ?? [];
  return {
    _state: state,
    _calls,
    channel: {
      async findMany(args: any) {
        record('channel.findMany', args);
        return channels.filter(c => !args.where.orgId || c.orgId === args.where.orgId);
      },
    },
    message: {
      async findMany(args: any) {
        record('message.findMany', args);
        const filtered = messages.filter(m => m.channelId === args.where.channelId);
        // Honour orderBy.createdAt:'desc' — the handler depends on it for its reverse() trick.
        if (args.orderBy?.createdAt === 'desc') {
          filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return filtered;
      },
      async create(args: any) {
        record('message.create', args);
        const created = { id: `msg-${messages.length + 1}`, createdAt: new Date(), ...args.data };
        messages.push(created);
        return created;
      },
    },
    task: {
      async findMany(args: any) {
        record('task.findMany', args);
        return tasks.filter(t => !args.where.orgId || t.orgId === args.where.orgId);
      },
      async create(args: any) {
        record('task.create', args);
        const created = { id: `task-${tasks.length + 1}`, ...args.data };
        tasks.push(created);
        return created;
      },
    },
    agent: {
      async findMany(args: any) {
        record('agent.findMany', args);
        return agents.filter(a => !args.where.orgId || a.orgId === args.where.orgId);
      },
    },
  };
}

const ctx = (orgId?: string) => ({ orgId });

// ── orgId gating ─────────────────────────────────────────────────

describe('mcp-tools — orgId gating (security)', () => {
  it('list_channels REJECTS missing orgId', async () => {
    const tools = buildToolCatalog(makeFakePrisma());
    const handler = tools.get('list_channels')!;
    await assert.rejects(() => Promise.resolve(handler.execute({}, ctx(undefined))));
  });

  it('list_tasks REJECTS missing orgId', async () => {
    const tools = buildToolCatalog(makeFakePrisma());
    const handler = tools.get('list_tasks')!;
    await assert.rejects(() => Promise.resolve(handler.execute({}, ctx(undefined))));
  });

  it('list_agents REJECTS missing orgId', async () => {
    const tools = buildToolCatalog(makeFakePrisma());
    const handler = tools.get('list_agents')!;
    await assert.rejects(() => Promise.resolve(handler.execute({}, ctx(undefined))));
  });

  it('create_task REJECTS missing orgId', async () => {
    const tools = buildToolCatalog(makeFakePrisma());
    const handler = tools.get('create_task')!;
    await assert.rejects(() => Promise.resolve(handler.execute({ title: 't', assigneeType: 'AGENT', assigneeId: 'a' }, ctx(undefined))));
  });
});

// ── list_channels ────────────────────────────────────────────────

describe('list_channels', () => {
  it('returns channels for the caller\'s org only', async () => {
    const prisma = makeFakePrisma({
      channels: [
        { id: 'c1', orgId: 'org-A', name: 'My channel', type: 'GROUP', createdAt: new Date() },
        { id: 'c2', orgId: 'org-B', name: 'Other', type: 'GROUP', createdAt: new Date() },
      ],
    });
    const tools = buildToolCatalog(prisma);
    const handler = tools.get('list_channels')!;
    const r = await handler.execute({}, ctx('org-A')) as any;
    assert.equal(r.channels.length, 1);
    assert.equal(r.channels[0].id, 'c1');
  });

  it('caps limit at 200', async () => {
    const prisma = makeFakePrisma();
    const tools = buildToolCatalog(prisma);
    const handler = tools.get('list_channels')!;
    await handler.execute({ limit: 9999 }, ctx('org-A'));
    assert.equal(prisma._calls['channel.findMany'][0].take, 200);
  });
});

// ── list_messages ────────────────────────────────────────────────

describe('list_messages', () => {
  it('reverses to oldest-first for human readability', async () => {
    const prisma = makeFakePrisma({
      messages: [
        { id: 'm-old',   channelId: 'c1', content: 'old',   createdAt: new Date('2026-05-12') },
        { id: 'm-mid',   channelId: 'c1', content: 'mid',   createdAt: new Date('2026-05-13') },
        { id: 'm-new',   channelId: 'c1', content: 'new',   createdAt: new Date('2026-05-14') },
      ],
    });
    const tools = buildToolCatalog(prisma);
    const handler = tools.get('list_messages')!;
    const r = await handler.execute({ channelId: 'c1' }, ctx('org-A')) as any;
    // findMany returned newest-first; handler reverses so OLDEST is index 0
    assert.equal(r.messages[0].id, 'm-old');
  });
});

// ── send_message ─────────────────────────────────────────────────

describe('send_message', () => {
  it('creates a HUMAN-actor message', async () => {
    const prisma = makeFakePrisma();
    const tools = buildToolCatalog(prisma);
    const handler = tools.get('send_message')!;
    const r = await handler.execute(
      { channelId: 'c1', content: 'hello' },
      ctx('org-A'),
    ) as any;
    assert.ok(r.messageId);
    const call = prisma._calls['message.create'][0];
    assert.equal(call.data.channelId, 'c1');
    assert.equal(call.data.senderType, 'HUMAN');
    assert.equal(call.data.content, 'hello');
    assert.equal(call.data.contentType, 'TEXT'); // default
  });

  it('respects custom contentType', async () => {
    const prisma = makeFakePrisma();
    const tools = buildToolCatalog(prisma);
    const handler = tools.get('send_message')!;
    await handler.execute({ channelId: 'c1', content: '{}', contentType: 'JSON' }, ctx('org-A'));
    assert.equal(prisma._calls['message.create'][0].data.contentType, 'JSON');
  });
});

// ── list_tasks ───────────────────────────────────────────────────

describe('list_tasks', () => {
  it('filters by status when provided', async () => {
    const prisma = makeFakePrisma({
      tasks: [
        { id: 't1', orgId: 'org-A', status: 'PENDING' },
        { id: 't2', orgId: 'org-A', status: 'COMPLETED' },
      ],
    });
    const tools = buildToolCatalog(prisma);
    const handler = tools.get('list_tasks')!;
    await handler.execute({ status: 'PENDING' }, ctx('org-A'));
    const call = prisma._calls['task.findMany'][0];
    assert.equal(call.where.status, 'PENDING');
  });
});

// ── create_task ──────────────────────────────────────────────────

describe('create_task', () => {
  it('creates a HUMAN-creator task with sane defaults', async () => {
    const prisma = makeFakePrisma();
    const tools = buildToolCatalog(prisma);
    const handler = tools.get('create_task')!;
    const r = await handler.execute(
      { title: 'Demo', assigneeType: 'AGENT', assigneeId: 'agent-1' },
      ctx('org-A'),
    ) as any;
    assert.ok(r.taskId);
    const call = prisma._calls['task.create'][0];
    assert.equal(call.data.title, 'Demo');
    assert.equal(call.data.orgId, 'org-A');
    assert.equal(call.data.creatorType, 'HUMAN');
    assert.equal(call.data.status, 'PENDING');
    assert.equal(call.data.priority, 'MEDIUM'); // default
  });

  it('parses deadline string into Date', async () => {
    const prisma = makeFakePrisma();
    const tools = buildToolCatalog(prisma);
    const handler = tools.get('create_task')!;
    await handler.execute(
      { title: 'X', assigneeType: 'AGENT', assigneeId: 'a', deadline: '2026-06-01T12:00:00Z' },
      ctx('org-A'),
    );
    const call = prisma._calls['task.create'][0];
    assert.ok(call.data.deadline instanceof Date);
  });
});

// ── catalog completeness ─────────────────────────────────────────

describe('buildToolCatalog', () => {
  it('exposes the 6 documented tools', () => {
    const tools = buildToolCatalog(makeFakePrisma());
    const expected = ['list_channels', 'list_messages', 'send_message', 'list_tasks', 'create_task', 'list_agents'];
    for (const name of expected) {
      assert.ok(tools.has(name), `missing ${name}`);
      assert.ok(tools.get(name)!.inputSchema, `${name} missing inputSchema`);
    }
  });
});
