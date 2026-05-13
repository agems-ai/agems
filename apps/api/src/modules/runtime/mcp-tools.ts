/**
 * Tool catalog for the AGEMS MCP-server endpoint.
 *
 * Builds a Map<name, McpToolHandler> with closures over a PrismaService
 * (and friends). The dispatcher (mcp-dispatch.ts) only sees the map —
 * this module is the place that talks to the DB.
 *
 * Tools exposed (read-only by default; create/update gated by orgId
 * presence on the dispatch context):
 *
 *   - list_channels    — recent channels in the org
 *   - list_messages    — last N messages in a channel
 *   - send_message     — post a message AS a HUMAN actor
 *   - list_tasks       — open tasks (status filter optional)
 *   - create_task      — create a new HUMAN-assigned task
 *   - list_agents      — agents in the org with status / slug / role
 *
 * Each tool is registered via a typed factory; everything stays
 * testable with a fake Prisma surface.
 */
import { ForbiddenException } from '@nestjs/common';
import type { McpToolHandler } from './mcp-dispatch';

/** Minimal Prisma surface needed by the tool catalog. */
export interface McpPrisma {
  channel: {
    findMany(args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      take?: number;
    }): Promise<any[]>;
  };
  message: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      take?: number;
    }): Promise<any[]>;
    create(args: { data: Record<string, unknown> }): Promise<any>;
  };
  task: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      take?: number;
    }): Promise<any[]>;
    create(args: { data: Record<string, unknown> }): Promise<any>;
  };
  agent: {
    findMany(args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
      take?: number;
    }): Promise<any[]>;
  };
}

function requireOrg(orgId: string | undefined): string {
  if (!orgId) {
    // Wrap in JSON-RPC InternalError via dispatcher's catch.
    throw new ForbiddenException('orgId required for this tool — provide MCP token');
  }
  return orgId;
}

export function buildToolCatalog(prisma: McpPrisma): Map<string, McpToolHandler> {
  const tools = new Map<string, McpToolHandler>();

  tools.set('list_channels', {
    name: 'list_channels',
    description: 'List recent channels in the caller\'s organisation.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max channels to return (default 50)' },
        type: { type: 'string', description: 'Filter by ChannelType (DIRECT/GROUP/BROADCAST/SYSTEM)' },
      },
    },
    async execute(args, ctx) {
      const orgId = requireOrg(ctx.orgId);
      const channels = await prisma.channel.findMany({
        where: { orgId, ...(args.type ? { type: args.type as any } : {}) },
        select: { id: true, name: true, type: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: Math.min((args.limit as number) ?? 50, 200),
      });
      return { channels };
    },
  });

  tools.set('list_messages', {
    name: 'list_messages',
    description: 'Read the last N messages from a channel.',
    inputSchema: {
      type: 'object',
      required: ['channelId'],
      properties: {
        channelId: { type: 'string' },
        limit: { type: 'number', description: 'Max messages (default 50, max 200)' },
      },
    },
    async execute(args, ctx) {
      requireOrg(ctx.orgId);
      const limit = Math.min((args.limit as number) ?? 50, 200);
      const messages = await prisma.message.findMany({
        where: { channelId: args.channelId as string },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return { messages: messages.reverse() }; // oldest-first for readability
    },
  });

  tools.set('send_message', {
    name: 'send_message',
    description: 'Post a message to a channel AS a human actor. Use list_channels to find a channel id.',
    inputSchema: {
      type: 'object',
      required: ['channelId', 'content'],
      properties: {
        channelId: { type: 'string' },
        content: { type: 'string' },
        contentType: { type: 'string', description: 'TEXT (default), JSON, FILE, ACTION' },
      },
    },
    async execute(args, ctx) {
      requireOrg(ctx.orgId);
      const msg = await prisma.message.create({
        data: {
          channelId: args.channelId as string,
          senderType: 'HUMAN',
          senderId: ctx.orgId!, // best effort — real user-id would come from a user-bound MCP token
          content: args.content as string,
          contentType: (args.contentType as any) ?? 'TEXT',
        },
      });
      return { messageId: msg.id, createdAt: msg.createdAt };
    },
  });

  tools.set('list_tasks', {
    name: 'list_tasks',
    description: 'List tasks in the caller\'s organisation, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'PENDING / IN_PROGRESS / IN_REVIEW / COMPLETED ...' },
        limit: { type: 'number', description: 'Max (default 50)' },
      },
    },
    async execute(args, ctx) {
      const orgId = requireOrg(ctx.orgId);
      const tasks = await prisma.task.findMany({
        where: { orgId, ...(args.status ? { status: args.status as any } : {}) },
        orderBy: { createdAt: 'desc' },
        take: Math.min((args.limit as number) ?? 50, 200),
      });
      return { tasks };
    },
  });

  tools.set('create_task', {
    name: 'create_task',
    description: 'Create a new task in the org, assigned to a specific agent or human.',
    inputSchema: {
      type: 'object',
      required: ['title', 'assigneeType', 'assigneeId'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', description: 'LOW / MEDIUM / HIGH / CRITICAL' },
        assigneeType: { type: 'string', description: 'AGENT / HUMAN' },
        assigneeId: { type: 'string' },
        deadline: { type: 'string', description: 'ISO 8601 timestamp' },
      },
    },
    async execute(args, ctx) {
      const orgId = requireOrg(ctx.orgId);
      const task = await prisma.task.create({
        data: {
          orgId,
          title: args.title as string,
          description: (args.description as string) ?? null,
          priority: (args.priority as any) ?? 'MEDIUM',
          creatorType: 'HUMAN',
          creatorId: orgId,
          assigneeType: args.assigneeType as any,
          assigneeId: args.assigneeId as string,
          deadline: args.deadline ? new Date(args.deadline as string) : null,
          status: 'PENDING',
        },
      });
      return { taskId: task.id, status: task.status };
    },
  });

  tools.set('list_agents', {
    name: 'list_agents',
    description: 'List agents in the org with slug, name, status, role.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'DRAFT / ACTIVE / PAUSED / ERROR / ARCHIVED' },
      },
    },
    async execute(args, ctx) {
      const orgId = requireOrg(ctx.orgId);
      const agents = await prisma.agent.findMany({
        where: { orgId, ...(args.status ? { status: args.status as any } : {}) },
        select: { id: true, slug: true, name: true, status: true, llmModel: true, llmProvider: true },
        take: 200,
      });
      return { agents };
    },
  });

  return tools;
}
