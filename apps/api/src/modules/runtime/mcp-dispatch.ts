/**
 * Minimal JSON-RPC 2.0 dispatcher for an MCP-server endpoint.
 *
 * Inspired by Hermes' `mcp_serve.py`: AGEMS exposes itself as an MCP
 * source so external Claude Code / Cursor / Codex sessions can list
 * AGEMS channels, send messages, list and create tasks, etc.
 *
 * Why hand-rolled instead of @modelcontextprotocol/sdk:
 *   - the SDK assumes you own the transport (stdio / SSE); we run
 *     inside NestJS with HTTP/Express already serving the API.
 *   - the wire-level surface we need is small: tools/list, tools/call,
 *     initialize, ping. Pure JSON-RPC over POST covers it.
 *   - keeps deps small (no SDK in apps/api).
 *
 * This module owns: request parsing, response shaping, tool dispatch.
 * NOT: actual tool implementations (handed to the caller via a tool
 * map). NOT: transport (controller handles HTTP).
 *
 * Pure: no DB, no Nest. The dispatcher's `tools` map is built by the
 * controller with closures over PrismaService.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** Standard JSON-RPC error codes (subset). */
export const JsonRpcCodes = {
  ParseError:     -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams:  -32602,
  InternalError:  -32603,
} as const;

export interface McpToolHandler {
  name: string;
  description: string;
  /** JSON Schema for the inputSchema field of tools/list. */
  inputSchema: Record<string, unknown>;
  /** Pure or async handler. Throws → InvalidParams or InternalError. */
  execute(args: Record<string, unknown>, ctx: { orgId?: string }): Promise<unknown> | unknown;
}

export interface DispatchContext {
  /** Org id resolved from auth — null when caller is unauthenticated. */
  orgId?: string;
  /** Server identity returned by `initialize`. */
  serverInfo: { name: string; version: string };
}

/**
 * Parse and validate a single JSON-RPC request envelope. Returns either
 * a structured error response or the well-formed request.
 */
export function parseRequest(raw: unknown): JsonRpcRequest | JsonRpcError {
  if (typeof raw !== 'object' || raw === null) {
    return errorFor(null, JsonRpcCodes.InvalidRequest, 'request must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.jsonrpc !== '2.0') {
    return errorFor((obj.id as any) ?? null, JsonRpcCodes.InvalidRequest, 'jsonrpc must be "2.0"');
  }
  if (typeof obj.method !== 'string' || !obj.method) {
    return errorFor((obj.id as any) ?? null, JsonRpcCodes.InvalidRequest, 'method is required');
  }
  if (obj.params !== undefined && (typeof obj.params !== 'object' || obj.params === null)) {
    return errorFor((obj.id as any) ?? null, JsonRpcCodes.InvalidParams, 'params must be an object when present');
  }
  return {
    jsonrpc: '2.0',
    id: (obj.id as any) ?? null,
    method: obj.method,
    params: (obj.params as Record<string, unknown> | undefined) ?? {},
  };
}

export function errorFor(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

export function successFor(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Build the response to `tools/list`. Pure: derives from the tool map.
 */
export function buildToolsList(tools: Map<string, McpToolHandler>): unknown {
  return {
    tools: Array.from(tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

/**
 * Dispatch a single JSON-RPC request. Returns a fully-shaped response.
 * Never throws — internal errors become JSON-RPC error objects.
 */
export async function dispatch(
  raw: unknown,
  tools: Map<string, McpToolHandler>,
  ctx: DispatchContext,
): Promise<JsonRpcResponse> {
  const parsed = parseRequest(raw);
  if ('error' in parsed) return parsed;

  try {
    switch (parsed.method) {
      case 'initialize':
        return successFor(parsed.id, {
          serverInfo: ctx.serverInfo,
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
        });

      case 'ping':
        return successFor(parsed.id, { ok: true });

      case 'tools/list':
        return successFor(parsed.id, buildToolsList(tools));

      case 'tools/call': {
        const name = parsed.params?.name as string | undefined;
        const args = (parsed.params?.arguments as Record<string, unknown> | undefined) ?? {};
        if (!name) {
          return errorFor(parsed.id, JsonRpcCodes.InvalidParams, 'tools/call requires `name`');
        }
        const tool = tools.get(name);
        if (!tool) {
          return errorFor(parsed.id, JsonRpcCodes.MethodNotFound, `unknown tool: ${name}`);
        }
        const result = await tool.execute(args, { orgId: ctx.orgId });
        // MCP convention: tools/call result is { content: [{ type: 'text', text: ... }] }
        // We accept either shape — passthrough if the handler already shaped it.
        const shaped = isMcpToolResult(result) ? result : asTextResult(result);
        return successFor(parsed.id, shaped);
      }

      default:
        return errorFor(parsed.id, JsonRpcCodes.MethodNotFound, `unknown method: ${parsed.method}`);
    }
  } catch (err) {
    return errorFor(parsed.id, JsonRpcCodes.InternalError, (err as Error).message);
  }
}

function isMcpToolResult(v: unknown): boolean {
  return typeof v === 'object'
    && v !== null
    && Array.isArray((v as any).content);
}

function asTextResult(v: unknown): unknown {
  return { content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] };
}
