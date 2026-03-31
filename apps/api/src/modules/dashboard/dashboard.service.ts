import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  private isBlockedHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
    if (normalized === '0.0.0.0' || normalized === '127.0.0.1' || normalized === '::1') return true;
    if (/^10\./.test(normalized)) return true;
    if (/^192\.168\./.test(normalized)) return true;
    if (/^169\.254\./.test(normalized)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
    if (normalized === 'metadata.google.internal') return true;
    return false;
  }

  /** Real-time agent activity: running + recent executions */
  async getActivity(orgId?: string) {
    const orgFilter = orgId ? { agent: { orgId } } : {};

    const [running, recent] = await Promise.all([
      this.prisma.agentExecution.findMany({
        where: { status: 'RUNNING', ...orgFilter },
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.agentExecution.findMany({
        where: { status: { in: ['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_HITL'] }, ...orgFilter },
        include: { agent: { select: { id: true, name: true } } },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
    ]);

    return { running, recent };
  }

  /** Get system-level statistics for the org */
  async getSystemStats(orgId?: string) {
    const orgFilter = orgId ? { orgId } : {};

    const [
      agentsByStatus,
      toolsCount,
      skillsCount,
      tasksByStatus,
      recentExecutions,
      channelsCount,
      messagesLast7d,
      pendingApprovals,
      meetingsCount,
      membersCount,
    ] = await Promise.all([
      this.prisma.agent.groupBy({ by: ['status'], where: orgFilter, _count: true }),
      this.prisma.tool.count({ where: orgFilter }),
      this.prisma.skill.count({ where: orgFilter }),
      this.prisma.task.groupBy({ by: ['status'], where: orgFilter, _count: true }),
      this.prisma.agentExecution.findMany({
        where: { agent: orgFilter },
        orderBy: { startedAt: 'desc' },
        take: 50,
        select: { status: true, startedAt: true },
      }),
      this.prisma.channel.count({ where: orgFilter }),
      this.prisma.message.count({
        where: {
          channel: orgFilter,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.approvalRequest.count({
        where: { status: 'PENDING', agent: orgFilter },
      }),
      this.prisma.meeting.count({ where: orgFilter }),
      orgId ? this.prisma.orgMember.count({ where: { orgId } }) : 0,
    ]);

    // Agent stats
    const agents = {
      total: agentsByStatus.reduce((s, g) => s + g._count, 0),
      byStatus: agentsByStatus.map(g => ({ label: g.status, value: g._count })),
    };

    // Task stats
    const tasks = {
      total: tasksByStatus.reduce((s, g) => s + g._count, 0),
      byStatus: tasksByStatus.map(g => ({ label: g.status, value: g._count })),
    };

    // Execution stats (last 50)
    const execStatusMap: Record<string, number> = {};
    for (const e of recentExecutions) {
      execStatusMap[e.status] = (execStatusMap[e.status] || 0) + 1;
    }
    const executions = {
      recent: recentExecutions.length,
      byStatus: Object.entries(execStatusMap).map(([label, value]) => ({ label, value })),
    };

    return {
      agents,
      tools: toolsCount,
      skills: skillsCount,
      tasks,
      executions,
      channels: channelsCount,
      messagesLast7d,
      pendingApprovals,
      meetings: meetingsCount,
      members: membersCount,
    };
  }

  /** List all tools available for widgets (DATABASE + REST_API) */
  async getTools(orgId?: string) {
    const tools = await this.prisma.tool.findMany({
      where: { type: { in: ['DATABASE', 'REST_API'] }, ...(orgId && { orgId }) },
      select: { id: true, name: true, type: true, config: true },
    });
    return tools.map((t) => {
      const config = t.config as any;
      return {
        id: t.id,
        name: t.name,
        type: t.type,
        database: config?.database || '',
        url: config?.url || '',
        description: config?.description || '',
      };
    });
  }

  /** Execute a read-only SQL query against a specific DATABASE tool */
  async executeQuery(toolId: string, sql: string, orgId?: string): Promise<{ data?: any[]; rowCount?: number; error?: string }> {
    const tool = await this.prisma.tool.findUnique({ where: { id: toolId } });
    if (!tool || tool.type !== 'DATABASE') {
      return { error: 'Database tool not found' };
    }
    if (orgId && tool.orgId !== orgId) {
      return { error: 'Database tool not found' };
    }

    const config = tool.config as any;
    const authConfig = (tool.authConfig || {}) as any;

    const upper = sql.trim().toUpperCase();
    if (
      !upper.startsWith('SELECT') &&
      !upper.startsWith('SHOW') &&
      !upper.startsWith('DESCRIBE') &&
      !upper.startsWith('EXPLAIN')
    ) {
      return { error: 'Only SELECT/SHOW/DESCRIBE/EXPLAIN queries are allowed.' };
    }

    if (/\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|INSERT|UPDATE|DELETE)\b/i.test(sql)) {
      return { error: 'Write/DDL operations are blocked for dashboard queries.' };
    }

    try {
      const mysql = await import('mysql2/promise');
      const conn = await mysql.createConnection({
        host: config.host || 'localhost',
        port: config.port || 3306,
        user: authConfig.username || 'root',
        password: authConfig.password || '',
        database: config.database || '',
        connectTimeout: 5000,
      });

      try {
        const needsLimit = upper.startsWith('SELECT') && !upper.includes('LIMIT');
        const finalSql = needsLimit ? sql.replace(/;?\s*$/, ' LIMIT 500') : sql.replace(/;?\s*$/, '');
        const [rows] = await conn.execute(finalSql);
        const result = Array.isArray(rows) ? rows : [];
        return { data: result.slice(0, 500), rowCount: result.length };
      } finally {
        await conn.end();
      }
    } catch (err: any) {
      this.logger.warn(`Dashboard query failed: ${err.message}`);
      return { error: err.message };
    }
  }

  /** Execute HTTP request via a REST_API tool (read-only GET) */
  async executeHttp(
    toolId: string,
    method: string,
    path: string,
    body?: any,
    queryParams?: Record<string, string>,
    orgId?: string,
  ): Promise<{ data?: any; error?: string }> {
    const tool = await this.prisma.tool.findUnique({ where: { id: toolId } });
    if (!tool || tool.type !== 'REST_API') {
      return { error: 'REST API tool not found' };
    }
    if (orgId && tool.orgId !== orgId) {
      return { error: 'REST API tool not found' };
    }

    const config = tool.config as any;
    const authConfig = (tool.authConfig || {}) as any;
    const baseUrl = (config.url || '').replace(/\/$/, '');

    try {
      if (method.toUpperCase() !== 'GET') {
        return { error: 'Only GET requests are allowed for dashboard HTTP tools.' };
      }

      let url = baseUrl + path;
      if (queryParams && Object.keys(queryParams).length > 0) {
        const qs = new URLSearchParams(queryParams).toString();
        url += (url.includes('?') ? '&' : '?') + qs;
      }

      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { error: 'Only http/https URLs are allowed.' };
      }
      if (this.isBlockedHostname(parsedUrl.hostname)) {
        return { error: 'Requests to local or private network destinations are blocked.' };
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      // Auth
      if (authConfig.token) {
        headers['Authorization'] = `Bearer ${authConfig.token}`;
      } else if (authConfig.apiKey) {
        if (authConfig.apiKeyHeader) {
          headers[authConfig.apiKeyHeader] = authConfig.apiKey;
        } else {
          headers['Authorization'] = `Bearer ${authConfig.apiKey}`;
        }
      } else if (authConfig.username && authConfig.password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')}`;
      }

      // Extra headers from config
      if (config.headers) {
        for (const [k, v] of Object.entries(config.headers)) {
          headers[k] = String(v);
        }
      }

      const fetchOpts: any = { method: 'GET', headers };

      const res = await fetch(url, fetchOpts);
      const text = await res.text();

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = text.slice(0, 5000);
      }

      if (!res.ok) {
        return { error: `HTTP ${res.status}: ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}` };
      }

      return { data };
    } catch (err: any) {
      this.logger.warn(`Dashboard HTTP call failed: ${err.message}`);
      return { error: err.message };
    }
  }

  /** Get saved dashboard widget configs from settings */
  async getWidgets(orgId?: string): Promise<any[]> {
    const all = await this.settings.getAll(orgId);
    const raw = all['dashboard_widgets'];
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** Save dashboard widget configs to settings */
  async saveWidgets(widgets: any[], orgId?: string) {
    await this.settings.set('dashboard_widgets', JSON.stringify(widgets), orgId);
    return widgets;
  }
}
