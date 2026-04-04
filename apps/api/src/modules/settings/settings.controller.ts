import { Controller, Get, Patch, Post, Delete, Body, Param, UseInterceptors, UploadedFile, Request } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { extname, join } from 'path';
import { execSync } from 'child_process';
import { SettingsService } from './settings.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types';

const HOST_REPO = '/app/host-repo';

// Keys that must never be exposed to VIEWER role
const SENSITIVE_KEYS = ['n8n_api_key', 'n8n_api_url', 'stripe_secret', 'webhook_secret'];

@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService, private events: EventEmitter2) {}

  @Get()
  async getAll(@Request() req: { user: RequestUser }) {
    const all = await this.settingsService.getAll(req.user.orgId);
    // Strip sensitive keys for VIEWER role (public read-only mode)
    if (req.user.role === 'VIEWER') {
      const safe = { ...all };
      for (const key of SENSITIVE_KEYS) delete safe[key];
      return safe;
    }
    return all;
  }

  @Patch()
  @Roles('MANAGER')
  setBulk(@Body() body: Record<string, string>, @Request() req: { user: RequestUser }) {
    return this.settingsService.setBulk(body, req.user.orgId);
  }

  @Get('llm-keys')
  getLlmKeys(@Request() req: { user: RequestUser }) {
    if (req.user.role === 'VIEWER') return {};
    return this.settingsService.getLlmKeys(req.user.orgId);
  }

  @Post('llm-keys')
  @Roles('ADMIN')
  setLlmKeys(@Body() body: Record<string, string>, @Request() req: { user: RequestUser }) {
    return this.settingsService.setLlmKeys(body, req.user.orgId);
  }

  @Get('users')
  getUsers(@Request() req: { user: RequestUser }) {
    return this.settingsService.getUsers(req.user.orgId);
  }

  @Post('users')
  @Roles('ADMIN')
  createUser(@Body() body: { email: string; password: string; name: string; role?: string }, @Request() req: { user: RequestUser }) {
    return this.settingsService.createUser(body, req.user.orgId);
  }

  @Patch('users/:id')
  @Roles('MANAGER')
  updateUser(@Param('id') id: string, @Body() body: { name?: string; email?: string; role?: string; password?: string }, @Request() req: { user: RequestUser }) {
    return this.settingsService.updateUser(id, body, req.user.orgId);
  }

  @Post('users/:id/avatar')
  @Roles('MANAGER')
  @UseInterceptors(FileInterceptor('avatar', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req: any, file: any, cb: any) => {
      if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
      else cb(new Error('Only image files allowed'), false);
    },
  }))
  async uploadAvatar(@Param('id') id: string, @UploadedFile() file: any, @Request() req: { user: RequestUser }) {
    const ext = extname(file.originalname).toLowerCase() || '.png';
    const filename = `${id}${ext}`;
    const dir = join(process.cwd(), 'apps/web/public/avatars/users');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), file.buffer);
    const avatarUrl = `/avatars/users/${filename}`;
    return this.settingsService.updateUser(id, { avatarUrl }, req.user.orgId);
  }

  @Delete('users/:id')
  @Roles('ADMIN')
  deleteUser(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.settingsService.deleteUser(id, req.user.orgId);
  }

  @Get('company')
  getCompanyProfile(@Request() req: { user: RequestUser }) {
    return this.settingsService.getCompanyProfile(req.user.orgId);
  }

  @Post('company')
  @Roles('MANAGER')
  setCompanyProfile(@Body() body: Record<string, string>, @Request() req: { user: RequestUser }) {
    return this.settingsService.setCompanyProfile(body, req.user.orgId);
  }

  @Get('task-agents')
  async getTaskAgentsConfig(@Request() req: { user: RequestUser }) {
    const enabled = await this.settingsService.get('task_agents_enabled', req.user.orgId);
    const interval = await this.settingsService.get('task_scheduler_interval', req.user.orgId);
    const reviewInterval = await this.settingsService.get('task_review_interval', req.user.orgId);
    const reviewBudget = await this.settingsService.get('task_review_daily_budget_usd', req.user.orgId);
    const autonomyLevel = await this.settingsService.getAutonomyLevel(req.user.orgId);
    return {
      enabled: enabled !== 'false',
      interval: interval ? parseInt(interval) : 60,
      reviewInterval: reviewInterval ? parseInt(reviewInterval) : 300,
      reviewBudget: reviewBudget ? parseFloat(reviewBudget) : 1.0,
      autonomyLevel,
    };
  }

  @Post('task-agents')
  @Roles('MANAGER')
  async setTaskAgentsConfig(@Body() body: { enabled?: boolean; interval?: number; reviewInterval?: number; reviewBudget?: number; autonomyLevel?: number }, @Request() req: { user: RequestUser }) {
    if (body.enabled !== undefined) {
      await this.settingsService.set('task_agents_enabled', String(body.enabled), req.user.orgId);
    }
    if (body.interval !== undefined && body.interval >= 10) {
      await this.settingsService.set('task_scheduler_interval', String(body.interval), req.user.orgId);
      this.events.emit('setting.task_scheduler_interval');
    }
    if (body.reviewInterval !== undefined && body.reviewInterval >= 30) {
      await this.settingsService.set('task_review_interval', String(body.reviewInterval), req.user.orgId);
    }
    if (body.reviewBudget !== undefined && body.reviewBudget >= 0) {
      await this.settingsService.set('task_review_daily_budget_usd', String(body.reviewBudget), req.user.orgId);
    }
    if (body.autonomyLevel !== undefined && body.autonomyLevel >= 1 && body.autonomyLevel <= 5) {
      await this.settingsService.set('autonomy_level', String(Math.round(body.autonomyLevel)), req.user.orgId);
    }
    const enabled = await this.settingsService.get('task_agents_enabled', req.user.orgId);
    const interval = await this.settingsService.get('task_scheduler_interval', req.user.orgId);
    const reviewInterval = await this.settingsService.get('task_review_interval', req.user.orgId);
    const reviewBudget = await this.settingsService.get('task_review_daily_budget_usd', req.user.orgId);
    const autonomyLevel = await this.settingsService.getAutonomyLevel(req.user.orgId);
    return {
      enabled: enabled !== 'false',
      interval: interval ? parseInt(interval) : 60,
      reviewInterval: reviewInterval ? parseInt(reviewInterval) : 300,
      reviewBudget: reviewBudget ? parseFloat(reviewBudget) : 1.0,
      autonomyLevel,
    };
  }

  // ── Module Settings (per-module enable/activity/autonomy) ──

  @Get('modules')
  getModulesConfig(@Request() req: { user: RequestUser }) {
    return this.settingsService.getAllModulesConfig(req.user.orgId);
  }

  @Post('modules')
  @Roles('MANAGER')
  setModulesConfig(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.settingsService.setAllModulesConfig(body, req.user.orgId);
  }

  @Get('n8n')
  getN8nConfig(@Request() req: { user: RequestUser }) {
    if (req.user.role === 'VIEWER') return { url: '', key: '' };
    return this.settingsService.getN8nConfig(req.user.orgId);
  }

  @Post('n8n')
  @Roles('ADMIN')
  setN8nConfig(@Body() body: { url: string; key?: string }, @Request() req: { user: RequestUser }) {
    return this.settingsService.setN8nConfig(body.url, body.key, req.user.orgId);
  }

  // ── System Prompts ──

  @Get('system-prompts')
  getSystemPrompts(@Request() req: { user: RequestUser }) {
    return this.settingsService.getSystemPrompts(req.user.orgId);
  }

  @Post('system-prompts')
  @Roles('ADMIN')
  setSystemPrompts(@Body() body: Record<string, string>, @Request() req: { user: RequestUser }) {
    return this.settingsService.setSystemPrompts(body, req.user.orgId);
  }

  @Post('system-prompts/reset')
  @Roles('ADMIN')
  resetSystemPrompt(@Body() body: { key: string }, @Request() req: { user: RequestUser }) {
    return this.settingsService.resetSystemPromptToDefault(body.key, req.user.orgId);
  }

  // ── System Update ──

  @Get('system/version')
  getSystemVersion() {
    const hasRepo = existsSync(join(HOST_REPO, '.git'));
    if (!hasRepo) {
      // Fall back to package.json version
      try {
        const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
        return { version: pkg.version || '0.0.0', commit: null, date: null, updateAvailable: false, canAutoUpdate: false };
      } catch {
        return { version: '0.0.0', commit: null, date: null, updateAvailable: false, canAutoUpdate: false };
      }
    }
    try {
      const commit = execSync('git rev-parse --short HEAD', { cwd: HOST_REPO }).toString().trim();
      const date = execSync('git log -1 --format=%ci', { cwd: HOST_REPO }).toString().trim();
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: HOST_REPO }).toString().trim();
      // Check for updates
      execSync('git fetch origin --quiet', { cwd: HOST_REPO, timeout: 15000 });
      const behind = execSync(`git rev-list HEAD..origin/${branch} --count`, { cwd: HOST_REPO }).toString().trim();
      const remoteCommit = execSync(`git rev-parse --short origin/${branch}`, { cwd: HOST_REPO }).toString().trim();
      const remoteLog = parseInt(behind) > 0
        ? execSync(`git log HEAD..origin/${branch} --oneline --no-decorate`, { cwd: HOST_REPO }).toString().trim()
        : '';
      return {
        version: commit,
        commit,
        date,
        branch,
        updateAvailable: parseInt(behind) > 0,
        commitsBehind: parseInt(behind),
        remoteCommit,
        remoteLog: remoteLog || null,
        canAutoUpdate: false,
      };
    } catch (e: any) {
      return { version: '?', commit: null, date: null, updateAvailable: false, canAutoUpdate: false, error: e.message };
    }
  }

  @Post('system/update')
  @Roles('ADMIN')
  async triggerSystemUpdate() {
    return { ok: false, error: 'Auto-update is disabled for security. Use manual deployment commands.' };
  }

}
