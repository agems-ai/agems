import { z } from 'zod';
import type { ToolDefinition } from './types';

export interface MCPServerConfig {
  name: string;
  url: string;
  authorizationToken?: string | null;
  toolConfiguration?: {
    enabled?: boolean | null;
    allowedTools?: string[] | null;
  } | null;
}

interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * Lightweight MCP client that connects to remote MCP servers via HTTP
 * (Streamable HTTP / JSON-RPC protocol).
 *
 * Supports both:
 * - Modern Streamable HTTP (POST to /mcp or server URL)
 * - Legacy SSE+HTTP (POST to server URL)
 */
export class MCPClient {
  private serverName: string;
  private url: string;
  private headers: Record<string, string>;
  private sessionId?: string;

  constructor(config: MCPServerConfig) {
    this.serverName = config.name;
    // Normalize URL: remove trailing /sse for legacy SSE endpoints
    this.url = config.url.replace(/\/sse\/?$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (config.authorizationToken) {
      this.headers['Authorization'] = `Bearer ${config.authorizationToken}`;
    }
  }

  private async jsonRpc(method: string, params?: any): Promise<any> {
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      ...(params !== undefined && { params }),
    };

    // Try the URL as-is first, then with /mcp suffix (unless URL already ends with /mcp)
    const urls = this.url.endsWith('/mcp') ? [this.url] : [this.url, `${this.url}/mcp`];
    let lastError: Error | null = null;

    for (const url of urls) {
      try {
        const headers = { ...this.headers };
        if (this.sessionId) {
          headers['Mcp-Session-Id'] = this.sessionId;
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          // If 404, try next URL
          if (response.status === 404) {
            lastError = new Error(`MCP server ${this.serverName}: ${url} returned 404`);
            continue;
          }
          throw new Error(`MCP server ${this.serverName}: HTTP ${response.status} ${response.statusText}`);
        }

        // Capture session ID from response
        const sid = response.headers.get('mcp-session-id');
        if (sid) this.sessionId = sid;

        const text = await response.text();
        if (!text || !text.trim()) {
          lastError = new Error(`MCP server ${this.serverName}: empty response`);
          continue;
        }
        // Handle SSE-wrapped responses
        if (text.startsWith('event:') || text.startsWith('data:')) {
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              if (data && data !== '[DONE]') {
                try {
                  return JSON.parse(data);
                } catch {
                  lastError = new Error(`MCP server ${this.serverName}: invalid JSON in SSE data`);
                  continue;
                }
              }
            }
          }
          lastError = new Error(`MCP server ${this.serverName}: no data in SSE response`);
          continue;
        }

        try {
          return JSON.parse(text);
        } catch {
          lastError = new Error(`MCP server ${this.serverName}: invalid JSON response: ${text.substring(0, 100)}`);
          continue;
        }
      } catch (err) {
        lastError = err as Error;
        if ((err as any)?.message?.includes('404')) continue;
        throw err;
      }
    }

    throw lastError || new Error(`MCP server ${this.serverName}: all endpoints failed`);
  }

  /** Initialize the MCP session */
  async initialize(): Promise<void> {
    await this.jsonRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agems', version: '1.0.0' },
    });
    // Send initialized notification (no response expected, but some servers need it)
    try {
      await this.jsonRpc('notifications/initialized');
    } catch {
      // Some servers don't support this — ignore
    }
  }

  /** List all tools from the MCP server */
  async listTools(): Promise<MCPToolSchema[]> {
    const response = await this.jsonRpc('tools/list');
    return response?.result?.tools || [];
  }

  /** Call a tool on the MCP server (auto-reconnects on session expiry, retries up to 3 times) */
  async callTool(name: string, args: Record<string, any>): Promise<any> {
    const retryableErrors = ['404', 'Session not found', 'empty response', 'invalid JSON', 'no data in SSE', 'fetch failed', 'ECONNREFUSED', 'ECONNRESET'];
    const maxRetries = 3;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.jsonRpc('tools/call', { name, arguments: args });
        if (response?.error) {
          throw new Error(`MCP tool ${name}: ${response.error.message || JSON.stringify(response.error)}`);
        }
        const result = response?.result;
        if (result?.content && Array.isArray(result.content)) {
          const texts = result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text);
          return texts.length === 1 ? texts[0] : texts.join('\n');
        }
        return result;
      } catch (err) {
        lastErr = err as Error;
        const msg = lastErr.message || '';
        const isRetryable = retryableErrors.some(e => msg.includes(e));
        if (!isRetryable || attempt === maxRetries - 1) throw lastErr;
        console.warn(`[MCP] ${this.serverName}.${name} attempt ${attempt + 1} failed: ${msg} — retrying in ${(attempt + 1)}s`);
        this.sessionId = undefined;
        await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
        try { await this.initialize(); } catch { /* will retry anyway */ }
      }
    }
    throw lastErr || new Error(`MCP tool ${name}: all retries failed`);
  }
}

/**
 * Convert MCP JSON Schema properties to a Zod object schema.
 * Handles basic types: string, number, integer, boolean, array, object.
 */
function jsonSchemaToZod(schema?: MCPToolSchema['inputSchema']): z.ZodType {
  if (!schema?.properties || Object.keys(schema.properties).length === 0) {
    return z.object({});
  }

  const shape: Record<string, z.ZodType> = {};
  const required = new Set(schema.required || []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    let field: z.ZodType;
    const p = prop as any;

    switch (p.type) {
      case 'number':
      case 'integer':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'array':
        field = z.array(z.any());
        break;
      case 'object':
        field = z.record(z.any());
        break;
      default:
        field = z.string();
    }

    if (p.description) {
      field = (field as any).describe(p.description);
    }

    if (!required.has(key)) {
      field = field.optional();
    }

    shape[key] = field;
  }

  return z.object(shape);
}

/**
 * Connect to MCP servers and return ToolDefinitions for all their tools.
 * Used for non-Anthropic providers (DeepSeek, OpenAI, Google, etc.)
 * that don't have native MCP support.
 */
export async function mcpServersToTools(servers: MCPServerConfig[]): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];

  for (const serverConfig of servers) {
    const allowedTools = serverConfig.toolConfiguration?.allowedTools;
    const enabled = serverConfig.toolConfiguration?.enabled;
    if (enabled === false) continue;

    const client = new MCPClient(serverConfig);
    try {
      await client.initialize();
      const mcpTools = await client.listTools();

      for (const mcpTool of mcpTools) {
        // Filter by allowedTools if specified
        if (allowedTools && !allowedTools.includes(mcpTool.name)) continue;

        const safeName = `${serverConfig.name}_${mcpTool.name}`.replace(/[^a-zA-Z0-9_]/g, '_');

        tools.push({
          name: safeName,
          description: `[${serverConfig.name}] ${mcpTool.description || mcpTool.name}`,
          parameters: jsonSchemaToZod(mcpTool.inputSchema),
          execute: async (params: unknown) => {
            return client.callTool(mcpTool.name, (params as Record<string, any>) || {});
          },
        });
      }
    } catch (err) {
      console.warn(`[MCP] Failed to connect to ${serverConfig.name} (${serverConfig.url}): ${err}`);
    }
  }

  return tools;
}
