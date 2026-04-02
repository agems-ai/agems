import { Injectable, ConflictException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import * as bcrypt from 'bcrypt';
import { AGEMS_DEFAULT_PREAMBLE } from './agems-defaults';

// ── Module Settings Types ──

export type ModuleName = 'tasks' | 'comms' | 'meetings' | 'goals' | 'projects';

export interface ModuleConfig {
  enabled: boolean;
  activityLevel: number;  // 1-5
  autonomyLevel: number;  // 1-5
}

export interface CrossChannelConfig {
  enabled: boolean;
  messageCount: number;  // how many messages from other channels to include
}

export interface AllModulesConfig {
  globalEnabled: boolean;
  crossChannel: CrossChannelConfig;
  modules: Record<ModuleName, ModuleConfig>;
}

export const MODULE_NAMES: ModuleName[] = ['tasks', 'comms', 'meetings', 'goals', 'projects'];

const MODULE_LABELS: Record<ModuleName, string> = {
  tasks: 'TASKS',
  comms: 'COMMS',
  meetings: 'MEETINGS',
  goals: 'GOALS',
  projects: 'PROJECTS',
};

const ACTIVITY_LABELS: Record<number, string> = {
  1: 'Passive',
  2: 'Reactive',
  3: 'Balanced',
  4: 'Proactive',
  5: 'Aggressive',
};

const AUTONOMY_LABELS: Record<number, string> = {
  1: 'Solo',
  2: 'Lean',
  3: 'Balanced',
  4: 'Team-first',
  5: 'Full team',
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  /** In-memory cache for module configs (per-org, 30s TTL) */
  private moduleConfigCache = new Map<string, { config: AllModulesConfig; fetchedAt: number }>();
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  private async getMembership(userId: string, orgId: string) {
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException('User not found in this organization');
    return membership;
  }

  async getAll(orgId?: string) {
    const rows = await this.prisma.setting.findMany({
      where: orgId ? { orgId } : { orgId: null },
    });
    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.key] = r.value;
    }
    return map;
  }

  async get(key: string, orgId?: string): Promise<string | null> {
    const row = await this.prisma.setting.findFirst({
      where: { key, ...(orgId ? { orgId } : { orgId: null }) },
    });
    return row?.value ?? null;
  }

  async set(key: string, value: string, orgId?: string) {
    const existing = await this.prisma.setting.findFirst({
      where: { key, ...(orgId ? { orgId } : { orgId: null }) },
    });
    if (existing) {
      return this.prisma.setting.update({ where: { id: existing.id }, data: { value } });
    }
    return this.prisma.setting.create({ data: { key, value, ...(orgId && { orgId }) } });
  }

  async setBulk(entries: Record<string, string>, orgId?: string) {
    for (const [key, value] of Object.entries(entries)) {
      await this.set(key, value, orgId);
    }
    return this.getAll(orgId);
  }

  async delete(key: string, orgId?: string) {
    return this.prisma.setting.deleteMany({
      where: { key, ...(orgId ? { orgId } : { orgId: null }) },
    });
  }

  // ── LLM Keys (masked for reading) ──

  async getLlmKeys(orgId?: string) {
    const keys = ['llm_key_openai', 'llm_key_anthropic', 'llm_key_google', 'llm_key_deepseek', 'llm_key_mistral'];
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys }, ...(orgId ? { orgId } : { orgId: null }) } });
    const result: Record<string, { set: boolean; masked: string }> = {};
    for (const k of keys) {
      const provider = k.replace('llm_key_', '');
      const row = rows.find((r) => r.key === k);
      result[provider] = {
        set: !!row?.value,
        masked: row?.value ? row.value.slice(0, 6) + '...' + row.value.slice(-4) : '',
      };
    }
    return result;
  }

  async setLlmKeys(keys: Record<string, string>, orgId?: string) {
    for (const [provider, value] of Object.entries(keys)) {
      if (value) await this.set(`llm_key_${provider}`, value, orgId);
    }
    return this.getLlmKeys(orgId);
  }

  // ── Users ──

  async getUsers(orgId?: string) {
    if (orgId) {
      const members = await this.prisma.orgMember.findMany({
        where: { orgId },
        include: { user: { select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true } } },
        orderBy: { joinedAt: 'asc' },
      });
      return members.map(m => ({ ...m.user, orgRole: m.role }));
    }
    return this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateUserRole(userId: string, role: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { role: role as any },
      select: { id: true, name: true, email: true, role: true },
    });
  }

  async createUser(data: { email: string; password: string; name: string; role?: string }, orgId?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        role: (data.role as any) || 'MEMBER',
      },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
    });

    // Add to organization if orgId provided
    if (orgId) {
      await this.prisma.orgMember.create({
        data: { orgId, userId: user.id, role: (data.role as any) || 'MEMBER' },
      });
    }

    this.events.emit('user.created', { id: user.id, name: user.name, orgId });
    return user;
  }

  async updateUser(userId: string, data: { name?: string; email?: string; role?: string; password?: string; avatarUrl?: string }, orgId: string) {
    const membership = await this.getMembership(userId, orgId);
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.avatarUrl) updateData.avatarUrl = data.avatarUrl;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);
    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }
    if (data.role && data.role !== membership.role) {
      await this.prisma.orgMember.update({
        where: { orgId_userId: { orgId, userId } },
        data: { role: data.role as any },
      });
    }
    const updatedMembership = await this.getMembership(userId, orgId);
    return {
      id: updatedMembership.user.id,
      name: updatedMembership.user.name,
      email: updatedMembership.user.email,
      role: updatedMembership.user.role,
      avatarUrl: updatedMembership.user.avatarUrl,
      createdAt: updatedMembership.user.createdAt,
      orgRole: updatedMembership.role,
    };
  }

  async deleteUser(userId: string, orgId: string) {
    const membership = await this.getMembership(userId, orgId);
    if (membership.role === 'ADMIN') {
      const adminCount = await this.prisma.orgMember.count({ where: { orgId, role: 'ADMIN' } });
      if (adminCount <= 1) throw new ForbiddenException('Cannot remove the last admin from the organization');
    }
    await this.prisma.orgMember.delete({
      where: { orgId_userId: { orgId, userId } },
    });
    return { id: membership.user.id, name: membership.user.name, email: membership.user.email };
  }

  // ── Company Profile ──

  private companyKeys = [
    'company_name', 'company_mission', 'company_vision', 'company_goals',
    'company_description', 'company_industry', 'company_website',
    'company_values', 'company_products', 'company_target_audience',
    'company_tone', 'company_languages', 'company_socials',
    'company_constitution',
  ];

  async getCompanyProfile(orgId?: string): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: this.companyKeys }, ...(orgId ? { orgId } : { orgId: null }) },
    });
    const result: Record<string, string> = {};
    for (const k of this.companyKeys) {
      result[k] = rows.find((r) => r.key === k)?.value ?? '';
    }
    return result;
  }

  async setCompanyProfile(data: Record<string, string>, orgId?: string) {
    for (const [key, value] of Object.entries(data)) {
      if (this.companyKeys.includes(key) && value !== undefined) {
        await this.set(key, value, orgId);
      }
    }
    return this.getCompanyProfile(orgId);
  }

  /** Build company context string for agent system prompt injection */
  async getCompanyContext(orgId?: string): Promise<string> {
    const profile = await this.getCompanyProfile(orgId);
    const parts: string[] = [];
    if (profile.company_name) parts.push(`Company: ${profile.company_name}`);
    if (profile.company_industry) parts.push(`Industry: ${profile.company_industry}`);
    if (profile.company_description) parts.push(`About: ${profile.company_description}`);
    if (profile.company_mission) parts.push(`Mission: ${profile.company_mission}`);
    if (profile.company_vision) parts.push(`Vision: ${profile.company_vision}`);
    if (profile.company_goals) parts.push(`Goals: ${profile.company_goals}`);
    if (profile.company_values) parts.push(`Core Values: ${profile.company_values}`);
    if (profile.company_products) parts.push(`Products & Services: ${profile.company_products}`);
    if (profile.company_target_audience) parts.push(`Target Audience: ${profile.company_target_audience}`);
    if (profile.company_tone) parts.push(`Communication Tone: ${profile.company_tone}`);
    if (profile.company_languages) parts.push(`Languages: ${profile.company_languages}`);
    if (profile.company_website) parts.push(`Website: ${profile.company_website}`);
    if (profile.company_socials) {
      try {
        const socials = JSON.parse(profile.company_socials) as Array<{ platform: string; url: string }>;
        const active = socials.filter(s => s.url);
        if (active.length) parts.push(`Social Media: ${active.map(s => `${s.platform}: ${s.url}`).join(', ')}`);
      } catch {}
    }
    if (parts.length === 0 && !profile.company_constitution) return '';
    let result = '';
    if (parts.length > 0) {
      result += `=== COMPANY CONTEXT ===\n${parts.join('\n')}\n=== END COMPANY CONTEXT ===\n\n`;
    }
    if (profile.company_constitution) {
      result += `=== COMPANY CONSTITUTION (MANDATORY) ===\nThe following rules are binding for ALL agents. Violations are not acceptable.\n\n${profile.company_constitution}\n=== END COMPANY CONSTITUTION ===\n\n`;
    }
    return result;
  }

  // ── N8N Config ──

  async getN8nConfig(orgId?: string) {
    const url = await this.get('n8n_api_url', orgId);
    const key = await this.get('n8n_api_key', orgId);
    return {
      url: url || '',
      keySet: !!key,
      keyMasked: key ? key.slice(0, 10) + '...' + key.slice(-6) : '',
    };
  }

  async setN8nConfig(url: string, key?: string, orgId?: string) {
    if (url) await this.set('n8n_api_url', url, orgId);
    if (key) await this.set('n8n_api_key', key, orgId);
    return this.getN8nConfig(orgId);
  }

  // ── Autonomy Level ──

  async getAutonomyLevel(orgId?: string): Promise<number> {
    const val = await this.get('autonomy_level', orgId);
    const level = val ? parseInt(val) : 3;
    return Math.max(1, Math.min(5, level));
  }

  /**
   * Build autonomy directive injected into every agent's system prompt.
   * Level 1 = maximum independence, Level 5 = maximum teamwork.
   */
  getAutonomyDirective(level: number): string {
    const directives: Record<number, string> = {
      1: `=== WORK MODE: SOLO (Autonomy Level 1/5) ===
You work INDEPENDENTLY. Do everything yourself whenever possible.
- Only create tasks for others when you genuinely CANNOT do the work (missing tools, access, or expertise).
- Do NOT involve other agents for simple or moderate tasks — just do it.
- Minimize meetings, approvals, and coordination overhead.
- Ask for help only as a last resort.
- Speed and efficiency are the priority.
=== END WORK MODE ===`,

      2: `=== WORK MODE: LEAN (Autonomy Level 2/5) ===
You prefer to work INDEPENDENTLY but delegate when it makes sense.
- Do tasks yourself if you have the skills and tools for it — even if imperfect.
- Only create tasks for specialists when the work REQUIRES their unique expertise (e.g., a developer should not write marketing copy, a copywriter should not write code).
- Keep task creation and meetings to a minimum.
- Prioritize getting things done over perfect process.
=== END WORK MODE ===`,

      3: `=== WORK MODE: BALANCED (Autonomy Level 3/5) ===
Use your JUDGMENT on when to work alone vs involve the team.
- Simple tasks (quick answers, small fixes, single-discipline work) — do them yourself.
- Complex multi-discipline projects — involve relevant specialists.
- Create tasks when work needs tracking or when delegating to the right person.
- Don't over-coordinate simple things, but don't try to do everything alone on big projects.
=== END WORK MODE ===`,

      4: `=== WORK MODE: TEAM-FIRST (Autonomy Level 4/5) ===
You DEFAULT to teamwork and delegation.
- For any non-trivial work, think: "Who is the best person for this?"
- Create tasks and assign to specialists even if you could do it yourself.
- Coordinate with colleagues via channels. Keep everyone informed.
- Only do work yourself when it's clearly within your core specialty.
- Use meetings for planning and alignment on multi-step projects.
=== END WORK MODE ===`,

      5: `=== WORK MODE: FULL COLLABORATION (Autonomy Level 5/5) ===
MAXIMUM teamwork. Every project involves the full relevant team.
- NEVER do multi-step work alone. Always identify and involve all relevant specialists.
- Use agems_tasks action="get_team" before starting any project to see available agents.
- Create a parent task for yourself, then subtasks for each specialist:
  Copy/text → copywriter, Design → designer, SEO → SEO specialist, Code → developer, Ads → ads manager, Analytics → analyst, QA → QA specialist.
- Message each assignee in their channel with full context.
- Wait for subtasks to complete. Review and integrate results. Do NOT do their work.
- Schedule meetings for planning and review sessions.
- Minimum team involvement: Landing page (Copywriter+Designer+SEO+Dev), Campaign (CMO+Ads+Copy+Analytics), Feature (Product+Design+Dev+QA).
=== END WORK MODE ===`,
    };

    return directives[level] || directives[3];
  }

  // ── System Prompts (AGEMS platform instructions for agents) ──

  private systemPromptKeys = ['agems_preamble'] as const;

  /**
   * Get the AGEMS platform preamble. Falls back to default if not yet stored in DB.
   * On first access, seeds the default into DB so it becomes editable.
   */
  async getAgemsPreamble(orgId?: string): Promise<string> {
    const stored = await this.get('agems_preamble', orgId);
    if (stored !== null) return stored;
    // First access — seed the default
    await this.set('agems_preamble', AGEMS_DEFAULT_PREAMBLE, orgId);
    return AGEMS_DEFAULT_PREAMBLE;
  }

  async setAgemsPreamble(value: string, orgId?: string) {
    await this.set('agems_preamble', value, orgId);
    return { agems_preamble: value };
  }

  async getSystemPrompts(orgId?: string) {
    const preamble = await this.getAgemsPreamble(orgId);
    return { agems_preamble: preamble };
  }

  async setSystemPrompts(data: Record<string, string>, orgId?: string) {
    if (data.agems_preamble !== undefined) {
      await this.set('agems_preamble', data.agems_preamble, orgId);
    }
    return this.getSystemPrompts(orgId);
  }

  async resetSystemPromptToDefault(key: string, orgId?: string) {
    if (key === 'agems_preamble') {
      await this.set('agems_preamble', AGEMS_DEFAULT_PREAMBLE, orgId);
      return { agems_preamble: AGEMS_DEFAULT_PREAMBLE };
    }
    return this.getSystemPrompts(orgId);
  }

  // ══════════════════════════════════════════════════════════
  // MODULE SETTINGS (per-org, per-module enable/activity/autonomy)
  // ══════════════════════════════════════════════════════════

  /** Get all module configs in a single DB query with fallback defaults */
  async getAllModulesConfig(orgId?: string): Promise<AllModulesConfig> {
    // Check cache first
    const cacheKey = orgId || '__global__';
    const cached = this.moduleConfigCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < SettingsService.CACHE_TTL_MS) {
      return cached.config;
    }

    // Build list of all keys we need
    const keys: string[] = ['task_agents_enabled', 'autonomy_level', 'cross_channel_enabled', 'cross_channel_messages'];
    for (const mod of MODULE_NAMES) {
      keys.push(`module_${mod}_enabled`, `module_${mod}_activity_level`, `module_${mod}_autonomy_level`);
    }

    const rows = await this.prisma.setting.findMany({
      where: { key: { in: keys }, ...(orgId ? { orgId } : { orgId: null }) },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    const globalEnabled = map['task_agents_enabled'] !== 'false';
    const globalAutonomy = map['autonomy_level'] ? parseInt(map['autonomy_level']) : 3;

    const modules = {} as Record<ModuleName, ModuleConfig>;
    for (const mod of MODULE_NAMES) {
      const enabledKey = `module_${mod}_enabled`;
      const activityKey = `module_${mod}_activity_level`;
      const autonomyKey = `module_${mod}_autonomy_level`;

      // Migration: if module key absent, inherit from legacy keys for tasks
      let enabled = true;
      if (map[enabledKey] !== undefined) {
        enabled = map[enabledKey] !== 'false';
      } else if (mod === 'tasks' && map['task_agents_enabled'] !== undefined) {
        enabled = map['task_agents_enabled'] !== 'false';
      }

      const activityLevel = map[activityKey] ? Math.max(1, Math.min(5, parseInt(map[activityKey]))) : 3;
      const autonomyLevel = map[autonomyKey] ? Math.max(1, Math.min(5, parseInt(map[autonomyKey]))) : globalAutonomy;

      modules[mod] = { enabled, activityLevel, autonomyLevel };
    }

    const crossChannel: CrossChannelConfig = {
      enabled: map['cross_channel_enabled'] === 'true',
      messageCount: map['cross_channel_messages'] ? Math.max(0, Math.min(50, parseInt(map['cross_channel_messages']))) : 10,
    };

    const config: AllModulesConfig = { globalEnabled, crossChannel, modules };

    // Update cache
    this.moduleConfigCache.set(cacheKey, { config, fetchedAt: Date.now() });

    return config;
  }

  /** Update module configs (partial update supported) */
  async setAllModulesConfig(data: Partial<AllModulesConfig>, orgId?: string): Promise<AllModulesConfig> {
    if (data.globalEnabled !== undefined) {
      await this.set('task_agents_enabled', String(data.globalEnabled), orgId);
    }

    if (data.crossChannel) {
      if (data.crossChannel.enabled !== undefined) {
        await this.set('cross_channel_enabled', String(data.crossChannel.enabled), orgId);
      }
      if (data.crossChannel.messageCount !== undefined) {
        const count = Math.max(0, Math.min(50, Math.round(data.crossChannel.messageCount)));
        await this.set('cross_channel_messages', String(count), orgId);
      }
    }

    if (data.modules) {
      for (const mod of MODULE_NAMES) {
        const mc = data.modules[mod];
        if (!mc) continue;
        if (mc.enabled !== undefined) {
          await this.set(`module_${mod}_enabled`, String(mc.enabled), orgId);
        }
        if (mc.activityLevel !== undefined) {
          const level = Math.max(1, Math.min(5, Math.round(mc.activityLevel)));
          await this.set(`module_${mod}_activity_level`, String(level), orgId);
        }
        if (mc.autonomyLevel !== undefined) {
          const level = Math.max(1, Math.min(5, Math.round(mc.autonomyLevel)));
          await this.set(`module_${mod}_autonomy_level`, String(level), orgId);
        }
      }
    }

    // Invalidate cache
    this.invalidateModuleCache(orgId);

    return this.getAllModulesConfig(orgId);
  }

  /** Check if a module is enabled (global master switch AND module toggle) */
  async isModuleEnabled(module: ModuleName, orgId?: string): Promise<boolean> {
    const config = await this.getAllModulesConfig(orgId);
    return config.globalEnabled && config.modules[module].enabled;
  }

  /** Get module config (activity + autonomy levels) */
  async getModuleConfig(module: ModuleName, orgId?: string): Promise<ModuleConfig> {
    const config = await this.getAllModulesConfig(orgId);
    return config.modules[module];
  }

  /** Invalidate module config cache for an org */
  private invalidateModuleCache(orgId?: string) {
    const cacheKey = orgId || '__global__';
    this.moduleConfigCache.delete(cacheKey);
  }

  /** Build combined module configuration directive for agent system prompt */
  async getModulesDirective(orgId?: string): Promise<string> {
    const config = await this.getAllModulesConfig(orgId);

    if (!config.globalEnabled) {
      return `=== MODULE CONFIGURATION ===\nALL MODULES DISABLED. Do not initiate any work, respond to messages, or participate in meetings.\n=== END MODULE CONFIGURATION ===`;
    }

    const sections: string[] = ['=== MODULE CONFIGURATION ==='];

    for (const mod of MODULE_NAMES) {
      const mc = config.modules[mod];
      const label = MODULE_LABELS[mod];

      if (!mc.enabled) {
        sections.push(`\n[${label}] DISABLED\n- Do NOT interact with ${label.toLowerCase()}. Ignore ${label.toLowerCase()}-related requests and activity.`);
        continue;
      }

      const actLabel = ACTIVITY_LABELS[mc.activityLevel] || 'Balanced';
      const autLabel = AUTONOMY_LABELS[mc.autonomyLevel] || 'Balanced';

      sections.push(`\n[${label}] ENABLED | Activity: ${actLabel} (${mc.activityLevel}/5) | Autonomy: ${autLabel} (${mc.autonomyLevel}/5)`);
      sections.push(`- ${this.getActivityDescription(mod, mc.activityLevel)}`);
      sections.push(`- ${this.getAutonomyDescription(mc.autonomyLevel)}`);
    }

    sections.push('\n=== END MODULE CONFIGURATION ===');
    return sections.join('\n');
  }

  /** Get activity description for a specific module and level */
  private getActivityDescription(module: ModuleName, level: number): string {
    const descriptions: Record<ModuleName, Record<number, string>> = {
      tasks: {
        1: 'Only execute tasks that are explicitly assigned to you. Do not create or suggest tasks.',
        2: 'Pick up assigned tasks promptly. Do not create tasks proactively.',
        3: 'Pick up assigned tasks and suggest improvements or follow-up tasks when relevant.',
        4: 'Proactively create tasks, flag blockers, and suggest work items. Drive task progress.',
        5: 'Autonomously create, organize, and prioritize tasks. Continuously monitor and drive all task work.',
      },
      comms: {
        1: 'Only respond in channels when directly @mentioned or asked a question.',
        2: 'Respond to direct questions and relevant discussions in your channels.',
        3: 'Participate in relevant discussions and offer helpful input when appropriate.',
        4: 'Initiate topic-relevant discussions and proactively share updates and insights.',
        5: 'Actively monitor all channels, initiate discussions, and drive conversations forward.',
      },
      meetings: {
        1: 'Only speak in meetings when directly asked a question.',
        2: 'Contribute when the topic matches your expertise. Keep responses concise.',
        3: 'Actively contribute opinions, vote on decisions, and offer suggestions.',
        4: 'Propose agenda items, drive decisions, and follow up on action items.',
        5: 'Schedule meetings proactively, drive full agendas, and ensure follow-through on all outcomes.',
      },
      goals: {
        1: 'Only work on goals when explicitly tasked to do so.',
        2: 'Track goal progress when prompted. Report status when asked.',
        3: 'Periodically review goal progress and suggest actions to stay on track.',
        4: 'Proactively create tasks to advance goals. Flag risks and blockers early.',
        5: 'Drive goal strategy autonomously. Create subgoals, assign work, and continuously push progress.',
      },
      projects: {
        1: 'Only manage projects when explicitly told to do so.',
        2: 'Track project deadlines and report status when asked.',
        3: 'Monitor project timelines, flag risks, and suggest adjustments.',
        4: 'Proactively create tasks, adjust priorities, and coordinate team members for projects.',
        5: 'Full project orchestration — plan, assign, track, and drive all project work autonomously.',
      },
    };
    return descriptions[module]?.[level] || descriptions[module]?.[3] || '';
  }

  /** Get autonomy description for a given level */
  private getAutonomyDescription(level: number): string {
    const descriptions: Record<number, string> = {
      1: 'Work independently. Only ask for help when you genuinely cannot do the work.',
      2: 'Prefer independent work. Delegate only when specialized expertise is required.',
      3: 'Use judgment — handle simple work alone, involve the team for complex multi-discipline tasks.',
      4: 'Default to teamwork. Think "who is the best person for this?" before doing work yourself.',
      5: 'Maximum collaboration. Identify and involve all relevant specialists. Create subtasks for each.',
    };
    return descriptions[level] || descriptions[3];
  }
}
