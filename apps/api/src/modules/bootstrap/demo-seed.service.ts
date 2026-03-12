import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { BootstrapService } from './bootstrap.service';
import {
  AGENT_TEMPLATES,
  TOOL_TEMPLATES,
  DEMO_COMPANY_SETTINGS,
  DEMO_STARTUP_SETTINGS,
  GLOBAL_SKILL_DEFINITIONS,
  type AgentTemplate,
} from './agent-templates';

const DEMO_ORG_METADATA = { isDemo: true };

@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(
    private prisma: PrismaService,
    private bootstrap: BootstrapService,
  ) {}

  /** Ensure global skills exist (orgId: null). Idempotent. */
  async ensureGlobalSkills() {
    const existing = await this.prisma.skill.findMany({
      where: { orgId: null },
      select: { slug: true },
    });
    const existingSlugs = new Set(existing.map(s => s.slug));

    for (const def of GLOBAL_SKILL_DEFINITIONS) {
      if (existingSlugs.has(def.slug)) continue;
      await this.prisma.skill.create({
        data: {
          name: def.name,
          slug: def.slug,
          description: def.description,
          content: def.content || '',
          version: '1.0.0',
          type: 'BUILTIN',
          entryPoint: '',
        },
      }).catch(() => {}); // ignore unique constraint race
    }
  }

  /**
   * Ensure demo orgs exist for a user. Idempotent — skips if already created.
   * Creates "Demo Company" (all 29 agents) and "Demo Startup" (8 essential agents).
   */
  async ensureDemoOrgs(userId: string) {
    // Ensure global skills exist first (needed for agent skill assignment)
    await this.ensureGlobalSkills();
    const memberships = await this.prisma.orgMember.findMany({
      where: { userId },
      include: { org: true },
    });

    const existingOrgs = memberships.map(m => m.org);
    const hasDemo = existingOrgs.some(o => (o.metadata as any)?.isDemo && (o.metadata as any)?.demoType === 'company');
    const hasStartup = existingOrgs.some(o => (o.metadata as any)?.isDemo && (o.metadata as any)?.demoType === 'startup');

    if (!hasDemo) {
      await this.createDemoOrg(userId, 'Demo Company', 'company', DEMO_COMPANY_SETTINGS, AGENT_TEMPLATES);
    }
    if (!hasStartup) {
      await this.createDemoOrg(userId, 'Demo Startup', 'startup', DEMO_STARTUP_SETTINGS, AGENT_TEMPLATES.filter(t => t.isStartupEssential));
    }
  }

  /**
   * Create a single demo org with agents, tools, skills, and settings.
   */
  private async createDemoOrg(
    userId: string,
    name: string,
    demoType: 'company' | 'startup',
    settings: Record<string, string>,
    templates: AgentTemplate[],
  ) {
    this.logger.log(`Creating "${name}" for user ${userId}...`);

    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${userId.slice(0, 8)}-${Date.now().toString(36)}`;
    const org = await this.prisma.organization.create({
      data: {
        name,
        slug,
        plan: 'FREE',
        metadata: { ...DEMO_ORG_METADATA, demoType },
      },
    });

    // Add user as ADMIN
    await this.prisma.orgMember.create({
      data: { orgId: org.id, userId, role: 'ADMIN' },
    });

    // Bootstrap Gemma
    await this.bootstrap.bootstrapOrg(org.id, userId);

    // Seed settings (no dashboard_widgets — let frontend use defaults)
    for (const [key, value] of Object.entries(settings)) {
      await this.prisma.setting.upsert({
        where: { orgId_key: { orgId: org.id, key } },
        create: { orgId: org.id, key, value },
        update: { value },
      });
    }

    // Create tool stubs (empty credentials)
    const toolMap = new Map<string, string>(); // tool template name -> created tool ID
    const neededTools = new Set<string>();
    for (const t of templates) {
      for (const toolName of t.tools) neededTools.add(toolName);
    }

    for (const toolName of neededTools) {
      const template = TOOL_TEMPLATES.find(tt => tt.name === toolName);
      if (!template) continue;
      const tool = await this.prisma.tool.create({
        data: {
          orgId: org.id,
          name: template.name,
          type: template.type as any,
          authType: template.authType as any,
          config: {},
          authConfig: {},
        },
      });
      toolMap.set(toolName, tool.id);
    }
    this.logger.log(`Created ${toolMap.size} tool stubs for "${name}"`);

    // Find global skills
    const globalSkills = await this.prisma.skill.findMany({
      where: { orgId: null },
      select: { id: true, slug: true },
    });
    const skillSlugToId = new Map<string, string>();
    for (const s of globalSkills) {
      skillSlugToId.set(s.slug, s.id);
    }

    // Create agents from templates
    for (const template of templates) {
      const agentSlug = `${template.slug}-${org.id.slice(0, 8)}`;
      const agent = await this.prisma.agent.create({
        data: {
          orgId: org.id,
          name: template.name,
          slug: agentSlug,
          avatar: template.avatar,
          type: template.type as any,
          status: 'ACTIVE',
          llmProvider: template.llmProvider as any,
          llmModel: template.llmModel,
          llmConfig: { temperature: 0.7, maxTokens: 8192 },
          systemPrompt: template.systemPrompt,
          mission: template.mission,
          values: ['efficiency', 'quality', 'collaboration'],
          runtimeConfig: {
            mode: 'CLAUDE_CODE',
            maxIterations: 30,
            timeoutMs: 120000,
            agemsApiAccess: true,
          },
          ownerId: userId,
          metadata: { fromTemplate: template.slug },
        },
      });

      // Assign tools
      for (const toolName of template.tools) {
        const toolId = toolMap.get(toolName);
        if (toolId) {
          await this.prisma.agentTool.create({
            data: {
              agentId: agent.id,
              toolId,
              permissions: { read: true, write: true, execute: true },
              enabled: true,
            },
          });
        }
      }

      // Assign skills (match by slug prefix)
      for (const skillPrefix of template.skills) {
        // Find skill whose slug starts with the prefix
        const match = globalSkills.find(s => s.slug.startsWith(skillPrefix));
        if (match) {
          await this.prisma.agentSkill.create({
            data: { agentId: agent.id, skillId: match.id, enabled: true },
          });
        }
      }

      // Create org position
      await this.prisma.orgPosition.create({
        data: {
          orgId: org.id,
          title: template.position,
          department: template.department,
          holderType: 'AGENT',
          agentId: agent.id,
        },
      });
    }

    this.logger.log(`Created ${templates.length} agents for "${name}" (org: ${org.id})`);

    // Assign ALL tools and skills to Gemma (she gets everything)
    const gemma = await this.prisma.agent.findFirst({
      where: { orgId: org.id, type: 'META' },
    });
    if (gemma) {
      for (const [, toolId] of toolMap) {
        await this.prisma.agentTool.upsert({
          where: { agentId_toolId: { agentId: gemma.id, toolId } },
          create: { agentId: gemma.id, toolId, permissions: { read: true, write: true, execute: true }, enabled: true },
          update: {},
        });
      }
    }

    return org;
  }

  /**
   * Import a single agent from template into an existing org.
   * Creates tool stubs (if not exist) and assigns skills.
   * Returns the created agent.
   */
  async importAgentFromTemplate(orgId: string, userId: string, templateSlug: string) {
    const template = AGENT_TEMPLATES.find(t => t.slug === templateSlug);
    if (!template) {
      throw new Error(`Agent template "${templateSlug}" not found`);
    }

    // Check if agent with same slug prefix already exists in this org
    const existing = await this.prisma.agent.findFirst({
      where: { orgId, slug: { startsWith: template.slug } },
    });
    if (existing) {
      throw new Error(`Agent "${template.name}" already exists in this organization`);
    }

    // Ensure tool stubs exist (reuse existing or create new)
    const toolMap = new Map<string, string>();
    for (const toolName of template.tools) {
      const toolTemplate = TOOL_TEMPLATES.find(tt => tt.name === toolName);
      if (!toolTemplate) continue;

      // Check if org already has this tool
      let tool = await this.prisma.tool.findFirst({
        where: { orgId, name: toolTemplate.name },
      });

      if (!tool) {
        tool = await this.prisma.tool.create({
          data: {
            orgId,
            name: toolTemplate.name,
            type: toolTemplate.type as any,
            authType: toolTemplate.authType as any,
            config: {},
            authConfig: {},
          },
        });
        this.logger.log(`Created tool stub "${toolTemplate.name}" for org ${orgId}`);
      }
      toolMap.set(toolName, tool.id);
    }

    // Create agent
    const agentSlug = `${template.slug}-${orgId.slice(0, 8)}`;
    const agent = await this.prisma.agent.create({
      data: {
        orgId,
        name: template.name,
        slug: agentSlug,
        avatar: template.avatar,
        type: template.type as any,
        status: 'ACTIVE',
        llmProvider: template.llmProvider as any,
        llmModel: template.llmModel,
        llmConfig: { temperature: 0.7, maxTokens: 8192 },
        systemPrompt: template.systemPrompt,
        mission: template.mission,
        values: ['efficiency', 'quality', 'collaboration'],
        runtimeConfig: {
          mode: 'CLAUDE_CODE',
          maxIterations: 30,
          timeoutMs: 120000,
          agemsApiAccess: true,
        },
        ownerId: userId,
        metadata: { fromTemplate: template.slug },
      },
    });

    // Assign tools
    for (const toolName of template.tools) {
      const toolId = toolMap.get(toolName);
      if (toolId) {
        await this.prisma.agentTool.create({
          data: {
            agentId: agent.id,
            toolId,
            permissions: { read: true, write: true, execute: true },
            enabled: true,
          },
        });
      }
    }

    // Assign skills
    const globalSkills = await this.prisma.skill.findMany({
      where: { orgId: null },
      select: { id: true, slug: true },
    });
    for (const skillPrefix of template.skills) {
      const match = globalSkills.find(s => s.slug.startsWith(skillPrefix));
      if (match) {
        await this.prisma.agentSkill.create({
          data: { agentId: agent.id, skillId: match.id, enabled: true },
        });
      }
    }

    // Create org position
    await this.prisma.orgPosition.create({
      data: {
        orgId,
        title: template.position,
        department: template.department,
        holderType: 'AGENT',
        agentId: agent.id,
      },
    });

    this.logger.log(`Imported agent "${template.name}" into org ${orgId}`);
    return agent;
  }
}
