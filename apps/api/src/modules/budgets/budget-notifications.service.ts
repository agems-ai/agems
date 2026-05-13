import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../../config/prisma.service';

/**
 * BudgetNotificationsService — listens to budget events and notifies the admin.
 *
 * Channels:
 *   1. Telegram: if settings `admin_tg_bot_token` + `admin_tg_chat_id` are configured,
 *      sends a message via HTTPS to the Bot API. No grammy bot instance needed.
 *   2. (Future) Inbox / email
 *
 * Events handled:
 *   - platform-budget.soft-alert → 80% of monthly platform limit
 *   - platform-budget.hard-stop  → 100% — all org agents paused
 *   - budget.soft-alert          → per-agent 80%
 *   - budget.hard-stop           → per-agent 100%, agent paused
 *   - agent.pause (reason=BUDGET_EXCEEDED) → fallback, covers runtime inline path
 */
@Injectable()
export class BudgetNotificationsService {
  private readonly logger = new Logger(BudgetNotificationsService.name);

  constructor(
    private settings: SettingsService,
    private prisma: PrismaService,
  ) {}

  @OnEvent('platform-budget.soft-alert')
  async onPlatformSoftAlert(payload: { orgId: string; spendUsd: number; limitUsd: number; percent: number }) {
    const text = [
      '⚠️ *Platform Budget — Soft Alert*',
      `Monthly spend reached *${payload.percent.toFixed(1)}%* of the platform limit.`,
      `Spend: *$${payload.spendUsd.toFixed(2)}* / *$${payload.limitUsd.toFixed(2)}*`,
      '',
      'Still running, but approaching the cap.',
      '[Open Budgets](https://survival.agems.ai/budgets)',
    ].join('\n');
    await this.sendTelegram(payload.orgId, text);
  }

  @OnEvent('platform-budget.hard-stop')
  async onPlatformHardStop(payload: { orgId: string; spendUsd: number; limitUsd: number }) {
    const text = [
      '🛑 *Platform Budget — HARD STOP*',
      `Monthly platform limit exceeded. *All agents are paused.*`,
      `Spend: *$${payload.spendUsd.toFixed(2)}* / *$${payload.limitUsd.toFixed(2)}*`,
      '',
      'Raise the limit or reset the budget to resume.',
      '[Open Budgets](https://survival.agems.ai/budgets)',
    ].join('\n');
    await this.sendTelegram(payload.orgId, text);
  }

  @OnEvent('budget.soft-alert')
  async onAgentSoftAlert(payload: { budgetId: string; agentId: string; agentName: string; spendUsd: number; limitUsd: number; percent: number }) {
    const orgId = await this.lookupOrgByAgent(payload.agentId);
    if (!orgId) return;
    const text = [
      `⚠️ *Agent Budget — Soft Alert*`,
      `*${payload.agentName}* reached *${payload.percent.toFixed(1)}%* of monthly budget.`,
      `Spend: *$${payload.spendUsd.toFixed(2)}* / *$${payload.limitUsd.toFixed(2)}*`,
      '[Open Budgets](https://survival.agems.ai/budgets)',
    ].join('\n');
    await this.sendTelegram(orgId, text);
  }

  @OnEvent('budget.hard-stop')
  async onAgentHardStop(payload: { budgetId: string; agentId: string; agentName: string; spendUsd: number; limitUsd: number }) {
    const orgId = await this.lookupOrgByAgent(payload.agentId);
    if (!orgId) return;
    const text = [
      `🛑 *Agent Budget — HARD STOP*`,
      `*${payload.agentName}* exceeded its monthly budget and is paused.`,
      `Spend: *$${payload.spendUsd.toFixed(2)}* / *$${payload.limitUsd.toFixed(2)}*`,
      '[Open Budgets](https://survival.agems.ai/budgets)',
    ].join('\n');
    await this.sendTelegram(orgId, text);
  }

  /** Proactive cost-spike alert from TaskScheduler.runSpikeAlertScan. */
  @OnEvent('budget.spike-detected')
  async onSpikeDetected(payload: {
    orgId: string;
    date: string;
    cost: number;
    multiplier: number;
    severity: 'minor' | 'major' | 'severe';
    message: string;
  }) {
    const icon = payload.severity === 'severe' ? '🚨' : payload.severity === 'major' ? '⚠️' : 'ℹ️';
    const text = [
      `${icon} *Cost Spike Detected — ${payload.severity}*`,
      `Day: *${payload.date}*`,
      `Spend: *$${payload.cost.toFixed(2)}* (*${payload.multiplier.toFixed(1)}×* the 14-day rolling median)`,
      '',
      'Investigate whether an agent is in a loop or a tool is misbehaving.',
      '[Open Budgets](https://survival.agems.ai/budgets)',
    ].join('\n');
    await this.sendTelegram(payload.orgId, text);
  }

  private async lookupOrgByAgent(agentId: string): Promise<string | null> {
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
    return agent?.orgId ?? null;
  }

  /**
   * Send a Markdown message to the admin Telegram chat.
   * Uses settings keys `admin_tg_bot_token` and `admin_tg_chat_id` (scoped to org).
   * Silently skips if either is missing.
   */
  private async sendTelegram(orgId: string, text: string): Promise<void> {
    try {
      const [token, chatId] = await Promise.all([
        this.settings.get('admin_tg_bot_token', orgId),
        this.settings.get('admin_tg_chat_id', orgId),
      ]);
      if (!token || !chatId) return;

      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const body = {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '<no body>');
        this.logger.warn(`Telegram notification failed (${res.status}): ${errText.slice(0, 200)}`);
      }
    } catch (err) {
      this.logger.error(`Failed to send Telegram notification: ${(err as Error).message}`);
    }
  }
}
