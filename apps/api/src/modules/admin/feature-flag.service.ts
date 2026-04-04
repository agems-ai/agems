import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
  rolloutPercentage?: number;
  targetPlans?: string[];
  targetOrgs?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SystemConfig {
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  blockedProviders: string[];
  rateLimitMultiplier: number;
  maxAgentsPerOrg: number;
  maxMembersPerOrg: number;
  registrationEnabled: boolean;
  stripeEnabled: boolean;
  telegramEnabled: boolean;
  n8nEnabled: boolean;
}

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  private readonly DEFAULT_FLAGS: FeatureFlag[] = [
    { key: 'agent_memory', enabled: true, description: 'Enable agent memory and learning capabilities', rolloutPercentage: 100 },
    { key: 'agent_observability', enabled: true, description: 'Enable trace and replay for agents', rolloutPercentage: 100 },
    { key: 'multi_agent', enabled: true, description: 'Enable multi-agent conversations', rolloutPercentage: 100 },
    { key: 'telegram_integration', enabled: true, description: 'Enable Telegram bot integration', rolloutPercentage: 100 },
    { key: 'n8n_integration', enabled: true, description: 'Enable N8N workflow integration', rolloutPercentage: 100 },
    { key: 'advanced_analytics', enabled: false, description: 'Enable advanced analytics dashboard', rolloutPercentage: 0, targetPlans: ['PRO', 'BUSINESS', 'ENTERPRISE'] },
    { key: 'custom_agent_prompts', enabled: true, description: 'Allow custom system prompts for agents', rolloutPercentage: 100 },
    { key: 'api_access', enabled: true, description: 'Enable API key access for agents', rolloutPercentage: 100 },
  ];

  private readonly DEFAULT_CONFIG: SystemConfig = {
    maintenanceMode: false,
    blockedProviders: [],
    rateLimitMultiplier: 1,
    maxAgentsPerOrg: 10,
    maxMembersPerOrg: 50,
    registrationEnabled: true,
    stripeEnabled: true,
    telegramEnabled: true,
    n8nEnabled: true,
  };

  constructor(private prisma: PrismaService) {}

  async getAllFlags(): Promise<FeatureFlag[]> {
    const settings = await this.prisma.setting.findMany({
      where: { key: { startsWith: 'feature:' }, orgId: null },
    });

    const flags = new Map<string, FeatureFlag>();
    for (const flag of this.DEFAULT_FLAGS) {
      flags.set(flag.key, flag);
    }

    for (const setting of settings) {
      const key = setting.key.replace('feature:', '');
      const value = JSON.parse(setting.value as string);
      flags.set(key, { key, ...value, updatedAt: setting.updatedAt });
    }

    return Array.from(flags.values());
  }

  async getFlag(key: string): Promise<FeatureFlag | null> {
    const setting = await this.prisma.setting.findFirst({
      where: { key: `feature:${key}`, orgId: null },
    });

    const defaultFlag = this.DEFAULT_FLAGS.find((f) => f.key === key);

    if (!setting && defaultFlag) return defaultFlag;
    if (!setting) return null;

    const value = JSON.parse(setting.value as string);
    return { key, ...value, updatedAt: setting.updatedAt };
  }

  async setFlag(key: string, updates: Partial<FeatureFlag>): Promise<FeatureFlag> {
    const existing = await this.getFlag(key);
    const flag = { ...existing, ...updates, key, updatedAt: new Date() };

    await this.prisma.setting.upsert({
      where: { orgId_key: { orgId: '', key: `feature:${key}` } },
      create: { key: `feature:${key}`, value: JSON.stringify(flag) },
      update: { value: JSON.stringify(flag) },
    });

    this.logger.log(`Feature flag updated: ${key} = ${flag.enabled}`);
    return flag;
  }

  async toggleFlag(key: string, enabled: boolean): Promise<FeatureFlag> {
    return this.setFlag(key, { enabled });
  }

  async isEnabled(key: string, context?: { orgId?: string; plan?: string }): Promise<boolean> {
    const flag = await this.getFlag(key);
    if (!flag || !flag.enabled) return false;

    if (flag.targetPlans && context?.plan) {
      if (!flag.targetPlans.includes(context.plan)) return false;
    }

    if (flag.targetOrgs && context?.orgId) {
      if (!flag.targetOrgs.includes(context.orgId)) return false;
    }

    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      if (context?.orgId) {
        const hash = context.orgId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const bucket = hash % 100;
        if (bucket >= flag.rolloutPercentage) return false;
      }
    }

    return true;
  }

  async getSystemConfig(): Promise<SystemConfig> {
    const settings = await this.prisma.setting.findMany({
      where: { key: { startsWith: 'system:' }, orgId: null },
    });

    const config: SystemConfig = { ...this.DEFAULT_CONFIG };

    for (const setting of settings) {
      const key = setting.key.replace('system:', '');
      const value = JSON.parse(setting.value as string);

      switch (key) {
        case 'maintenanceMode':
          config.maintenanceMode = value.enabled;
          config.maintenanceMessage = value.message;
          break;
        case 'blockedProviders':
          config.blockedProviders = value;
          break;
        case 'limits':
          config.maxAgentsPerOrg = value.maxAgents ?? config.maxAgentsPerOrg;
          config.maxMembersPerOrg = value.maxMembers ?? config.maxMembersPerOrg;
          break;
        case 'rateLimitMultiplier':
          config.rateLimitMultiplier = value;
          break;
        case 'registration':
          config.registrationEnabled = value;
          break;
        case 'integrations':
          config.stripeEnabled = value.stripe ?? true;
          config.telegramEnabled = value.telegram ?? true;
          config.n8nEnabled = value.n8n ?? true;
          break;
      }
    }

    return config;
  }

  async updateSystemConfig(updates: Partial<SystemConfig>): Promise<SystemConfig> {
    if (updates.maintenanceMode !== undefined) {
      await this.prisma.setting.upsert({
        where: { orgId_key: { orgId: '', key: 'system:maintenanceMode' } },
        create: { key: 'system:maintenanceMode', value: JSON.stringify({ enabled: updates.maintenanceMode, message: updates.maintenanceMessage }) },
        update: { value: JSON.stringify({ enabled: updates.maintenanceMode, message: updates.maintenanceMessage }) },
      });
    }

    if (updates.blockedProviders !== undefined) {
      await this.prisma.setting.upsert({
        where: { orgId_key: { orgId: '', key: 'system:blockedProviders' } },
        create: { key: 'system:blockedProviders', value: JSON.stringify(updates.blockedProviders) },
        update: { value: JSON.stringify(updates.blockedProviders) },
      });
    }

    if (updates.maxAgentsPerOrg !== undefined || updates.maxMembersPerOrg !== undefined) {
      await this.prisma.setting.upsert({
        where: { orgId_key: { orgId: '', key: 'system:limits' } },
        create: { key: 'system:limits', value: JSON.stringify({ maxAgents: updates.maxAgentsPerOrg, maxMembers: updates.maxMembersPerOrg }) },
        update: { value: JSON.stringify({ maxAgents: updates.maxAgentsPerOrg, maxMembers: updates.maxMembersPerOrg }) },
      });
    }

    this.logger.log(`System config updated: ${JSON.stringify(updates)}`);
    return this.getSystemConfig();
  }
}
