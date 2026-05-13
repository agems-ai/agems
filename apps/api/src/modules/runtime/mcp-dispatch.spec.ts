/**
 * Unit tests for MCP JSON-RPC dispatcher.
 *
 * If these break, external Claude Code / Cursor / Codex sessions
 * lose access to AGEMS — or worse, dispatch malformed shapes that
 * crash their clients.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRequest,
  buildToolsList,
  dispatch,
  successFor,
  errorFor,
  JsonRpcCodes,
  type McpToolHandler,
} from './mcp-dispatch';

const serverInfo = { name: 'agems', version: '1.0.0' };

function fakeTool(name: string, returnValue: unknown = `result-of-${name}`): McpToolHandler {
  return {
    name,
    description: `Test tool ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => returnValue,
  };
}

function fakeAsyncTool(name: string, returnValue: unknown): McpToolHandler {
  return {
    ...fakeTool(name, returnValue),
    execute: async () => returnValue,
  };
}

function fakeThrowingTool(name: string, message: string): McpToolHandler {
  return {
    ...fakeTool(name),
    execute: () => { throw new Error(message); },
  };
}

// ── parseRequest ─────────────────────────────────────────────────

describe('parseRequest', () => {
  it('accepts a well-formed JSON-RPC request', () => {
    const r = parseRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.ok('method' in r);
    if ('method' in r) {
      assert.equal(r.method, 'tools/list');
      assert.deepEqual(r.params, {});
    }
  });

  it('rejects when jsonrpc != "2.0"', () => {
    const r = parseRequest({ jsonrpc: '1.0', id: 1, method: 'x' });
    assert.ok('error' in r);
    if ('error' in r) assert.equal(r.error.code, JsonRpcCodes.InvalidRequest);
  });

  it('rejects when method is missing', () => {
    const r = parseRequest({ jsonrpc: '2.0', id: 1 });
    assert.ok('error' in r);
  });

  it('rejects non-object input', () => {
    assert.ok('error' in parseRequest(null));
    assert.ok('error' in parseRequest('not-object'));
    assert.ok('error' in parseRequest(42));
  });

  it('rejects when params is present but not an object', () => {
    const r = parseRequest({ jsonrpc: '2.0', id: 1, method: 'x', params: 'string' });
    assert.ok('error' in r);
    if ('error' in r) assert.equal(r.error.code, JsonRpcCodes.InvalidParams);
  });

  it('uses null id when input has no id (per JSON-RPC spec for notifications)', () => {
    const r = parseRequest({ jsonrpc: '2.0', method: 'ping' });
    if ('method' in r) assert.equal(r.id, null);
  });
});

// ── buildToolsList ───────────────────────────────────────────────

describe('buildToolsList', () => {
  it('emits { tools: [...] } with name + description + inputSchema', () => {
    const tools = new Map([['a', fakeTool('a')], ['b', fakeTool('b')]]);
    const list = buildToolsList(tools) as any;
    assert.equal(list.tools.length, 2);
    assert.equal(list.tools[0].name, 'a');
    assert.ok(list.tools[0].inputSchema);
  });

  it('returns empty array when map is empty', () => {
    const list = buildToolsList(new Map()) as any;
    assert.deepEqual(list.tools, []);
  });
});

// ── dispatch — initialize / ping / tools/list ───────────────────

describe('dispatch — protocol methods', () => {
  it('initialize returns serverInfo + capabilities', async () => {
    const tools = new Map();
    const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' }, tools, { serverInfo });
    assert.ok('result' in r);
    if ('result' in r) {
      const res = r.result as any;
      assert.deepEqual(res.serverInfo, serverInfo);
      assert.ok(res.protocolVersion);
      assert.ok(res.capabilities.tools);
    }
  });

  it('ping returns { ok: true }', async () => {
    const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'ping' }, new Map(), { serverInfo });
    assert.ok('result' in r);
    if ('result' in r) assert.deepEqual(r.result, { ok: true });
  });

  it('tools/list returns the registered tools', async () => {
    const tools = new Map([['x', fakeTool('x')]]);
    const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, tools, { serverInfo });
    assert.ok('result' in r);
    if ('result' in r) {
      const list = r.result as any;
      assert.equal(list.tools.length, 1);
      assert.equal(list.tools[0].name, 'x');
    }
  });

  it('unknown method returns MethodNotFound', async () => {
    const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'unknown/op' }, new Map(), { serverInfo });
    assert.ok('error' in r);
    if ('error' in r) assert.equal(r.error.code, JsonRpcCodes.MethodNotFound);
  });
});

// ── dispatch — tools/call ────────────────────────────────────────

describe('dispatch — tools/call', () => {
  it('routes to the named tool', async () => {
    const tools = new Map([['x', fakeTool('x', 'hello')]]);
    const r = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x', arguments: {} } },
      tools,
      { serverInfo },
    );
    assert.ok('result' in r);
    if ('result' in r) {
      const res = r.result as any;
      // Default shaping: { content: [{ type: 'text', text: 'hello' }] }
      assert.equal(res.content[0].type, 'text');
      assert.equal(res.content[0].text, 'hello');
    }
  });

  it('passes through a tool that already returns MCP shape', async () => {
    const tools = new Map([['x', {
      ...fakeTool('x'),
      execute: () => ({ content: [{ type: 'text', text: 'shaped' }] }),
    }]]);
    const r = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } },
      tools,
      { serverInfo },
    );
    if ('result' in r) {
      const res = r.result as any;
      assert.equal(res.content[0].text, 'shaped');
    }
  });

  it('serialises object results to JSON text', async () => {
    const tools = new Map([['x', fakeTool('x', { count: 42 })]]);
    const r = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } },
      tools,
      { serverInfo },
    );
    if ('result' in r) {
      const text = (r.result as any).content[0].text;
      assert.equal(JSON.parse(text).count, 42);
    }
  });

  it('awaits async tool handlers', async () => {
    const tools = new Map([['x', fakeAsyncTool('x', 'awaited')]]);
    const r = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } },
      tools,
      { serverInfo },
    );
    if ('result' in r) {
      assert.equal((r.result as any).content[0].text, 'awaited');
    }
  });

  it('returns InvalidParams when name is missing', async () => {
    const r = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} },
      new Map(),
      { serverInfo },
    );
    assert.ok('error' in r);
    if ('error' in r) assert.equal(r.error.code, JsonRpcCodes.InvalidParams);
  });

  it('returns MethodNotFound for unknown tool name', async () => {
    const r = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } },
      new Map(),
      { serverInfo },
    );
    assert.ok('error' in r);
    if ('error' in r) assert.equal(r.error.code, JsonRpcCodes.MethodNotFound);
  });

  it('catches handler exceptions as InternalError', async () => {
    const tools = new Map([['x', fakeThrowingTool('x', 'boom')]]);
    const r = await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } },
      tools,
      { serverInfo },
    );
    assert.ok('error' in r);
    if ('error' in r) {
      assert.equal(r.error.code, JsonRpcCodes.InternalError);
      assert.match(r.error.message, /boom/);
    }
  });

  it('passes orgId through to the handler', async () => {
    let receivedOrgId: string | undefined;
    const tools = new Map([['x', {
      ...fakeTool('x'),
      execute: (_args: any, ctx: any) => { receivedOrgId = ctx.orgId; return 'ok'; },
    }]]);
    await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } },
      tools,
      { serverInfo, orgId: 'org-123' },
    );
    assert.equal(receivedOrgId, 'org-123');
  });
});

// ── helpers ──────────────────────────────────────────────────────

describe('successFor / errorFor', () => {
  it('successFor wraps result with jsonrpc 2.0 envelope', () => {
    const r = successFor(7, { x: 1 });
    assert.equal(r.jsonrpc, '2.0');
    assert.equal(r.id, 7);
    assert.deepEqual(r.result, { x: 1 });
  });

  it('errorFor omits data when not provided', () => {
    const r = errorFor(1, JsonRpcCodes.InternalError, 'oops');
    assert.equal((r.error as any).data, undefined);
  });

  it('errorFor includes data when provided', () => {
    const r = errorFor(1, JsonRpcCodes.InternalError, 'oops', { hint: 'check logs' });
    assert.deepEqual((r.error as any).data, { hint: 'check logs' });
  });
});
