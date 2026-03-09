import { Injectable, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import * as bcrypt from 'bcrypt';
import { AGEMS_DEFAULT_PREAMBLE } from './agems-defaults';

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async getAll(orgId?: string) {
    const rows = await this.prisma.setting.findMany({
      where: orgId ? { orgId } : {},
    });
    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.key] = r.value;
    }
    return map;
  }

  async get(key: string, orgId?: string): Promise<string | null> {
    const row = await this.prisma.setting.findFirst({ where: { key, ...(orgId ? { orgId } : {}) } });
    return row?.value ?? null;
  }

  async set(key: string, value: string, orgId?: string) {
    const existing = await this.prisma.setting.findFirst({ where: { key, ...(orgId ? { orgId } : {}) } });
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
    return this.prisma.setting.deleteMany({ where: { key, ...(orgId ? { orgId } : {}) } });
  }

  // ── LLM Keys (masked for reading) ──

  async getLlmKeys(orgId?: string) {
    const keys = ['llm_key_openai', 'llm_key_anthropic', 'llm_key_google', 'llm_key_deepseek', 'llm_key_mistral'];
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys }, ...(orgId ? { orgId } : {}) } });
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

    this.events.emit('user.created', { id: user.id, name: user.name });
    return user;
  }

  async updateUser(userId: string, data: { name?: string; email?: string; role?: string; password?: string; avatarUrl?: string }) {
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.email) updateData.email = data.email;
    if (data.role) updateData.role = data.role;
    if (data.avatarUrl) updateData.avatarUrl = data.avatarUrl;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);
    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
    });
  }

  async deleteUser(userId: string) {
    return this.prisma.user.delete({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
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
      where: { key: { in: this.companyKeys }, ...(orgId ? { orgId } : {}) },
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
}
