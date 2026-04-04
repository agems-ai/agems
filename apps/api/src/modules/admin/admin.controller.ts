import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Query,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminAuditService } from './admin-audit.service';
import { TenantManagementService } from './tenant-management.service';
import { BillingManagementService } from './billing-management.service';
import { FeatureFlagService } from './feature-flag.service';
import { PlatformObservabilityService } from './platform-observability.service';
import { ModerationService } from './moderation.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditService: AdminAuditService,
    private readonly tenantService: TenantManagementService,
    private readonly billingService: BillingManagementService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly observabilityService: PlatformObservabilityService,
    private readonly moderationService: ModerationService,
  ) {}

  private async requireGlobalAdmin(userId: string): Promise<void> {
    const isGlobal = await this.adminService.isGlobalAdmin(userId);
    if (!isGlobal) throw new ForbiddenException('Global admin access required');
  }

  // ─── Stats ────────────────────────────────────────

  @Get('stats')
  @Roles('ADMIN')
  async getStats(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    const [stats, github] = await Promise.all([
      this.adminService.getStats(),
      this.adminService.getGitHubStats(),
    ]);
    const achievements = this.adminService.getGitHubAchievements(github);
    return { ...stats, github, achievements };
  }

  // ─── Users ────────────────────────────────────────

  @Get('users')
  @Roles('ADMIN')
  async getUsers(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.adminService.getAllUsers();
  }

  @Patch('users/:id/password')
  @Roles('ADMIN')
  async resetPassword(
    @Request() req: { user: RequestUser },
    @Param('id') userId: string,
    @Body() body: { password: string; reason?: string },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    const result = await this.adminService.resetUserPassword(userId, body.password);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'USER_PASSWORD_RESET',
      targetType: 'user',
      targetId: userId,
      reason: body.reason || 'Password reset by admin',
    });
    return result;
  }

  // ─── Tenant Management ────────────────────────────

  @Get('tenants')
  @Roles('ADMIN')
  async listTenants(
    @Request() req: { user: RequestUser },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('plan') plan?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.tenantService.listOrganizations({
      page: parseInt(page, 10),
      pageSize: parseInt(limit, 10),
      plan: plan as any,
      status: status as any,
      search,
    });
  }

  @Get('tenants/:id')
  @Roles('ADMIN')
  async getTenant(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    await this.requireGlobalAdmin(req.user.id);
    return this.tenantService.getOrganization(id);
  }

  @Get('tenants/:id/usage')
  @Roles('ADMIN')
  async getTenantUsage(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Query('days') days = '30',
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.tenantService.getUsageStats(id, parseInt(days, 10));
  }

  @Post('tenants/:id/suspend')
  @Roles('ADMIN')
  async suspendTenant(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    await this.tenantService.suspendOrganization(id, body.reason);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'ORG_BAN',
      targetType: 'org',
      targetId: id,
      reason: body.reason,
    });
    return { success: true };
  }

  @Post('tenants/:id/ban')
  @Roles('ADMIN')
  async banTenant(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    await this.tenantService.banOrganization(id, body.reason);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'ORG_BAN',
      targetType: 'org',
      targetId: id,
      reason: body.reason,
    });
    return { success: true };
  }

  @Post('tenants/:id/unban')
  @Roles('ADMIN')
  async unbanTenant(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    await this.requireGlobalAdmin(req.user.id);
    await this.tenantService.unbanOrganization(id);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'ORG_UNBAN',
      targetType: 'org',
      targetId: id,
      reason: 'Organization unbanned',
    });
    return { success: true };
  }

  @Patch('tenants/:id/plan')
  @Roles('ADMIN')
  async changeTenantPlan(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() body: { plan: string; reason: string },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    await this.tenantService.changePlan(id, body.plan as any, body.reason);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'ORG_PLAN_CHANGE',
      targetType: 'org',
      targetId: id,
      reason: `Plan changed to ${body.plan}: ${body.reason}`,
    });
    return { success: true };
  }

  @Delete('tenants/:id')
  @Roles('ADMIN')
  async deleteTenant(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    await this.requireGlobalAdmin(req.user.id);
    await this.tenantService.deleteOrganization(id);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'ORG_DELETE',
      targetType: 'org',
      targetId: id,
      reason: 'Organization deleted by admin',
    });
    return { success: true };
  }

  // ─── Billing Management ───────────────────────────

  @Get('billing/overview')
  @Roles('ADMIN')
  async getBillingOverview(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.billingService.getBillingOverview();
  }

  @Get('billing/payments')
  @Roles('ADMIN')
  async getPayments(
    @Request() req: { user: RequestUser },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('orgId') orgId?: string,
    @Query('status') status?: string,
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.billingService.getPayments({
      page: parseInt(page, 10),
      pageSize: parseInt(limit, 10),
      orgId,
      status,
    });
  }

  @Get('billing/subscriptions')
  @Roles('ADMIN')
  async getSubscriptions(
    @Request() req: { user: RequestUser },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.billingService.getSubscriptions({
      page: parseInt(page, 10),
      pageSize: parseInt(limit, 10),
      status,
    });
  }

  @Post('billing/refund')
  @Roles('ADMIN')
  async processRefund(
    @Request() req: { user: RequestUser },
    @Body() body: { paymentId: string; amount?: number; reason?: string },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    const result = await this.billingService.processRefund(body.paymentId, body.amount, body.reason);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'MANUAL_REFUND',
      targetType: 'system',
      targetId: body.paymentId,
      reason: body.reason || 'Refund processed',
    });
    return result;
  }

  @Patch('billing/subscriptions/:orgId')
  @Roles('ADMIN')
  async overrideSubscription(
    @Request() req: { user: RequestUser },
    @Param('orgId') orgId: string,
    @Body() body: { plan?: string; status?: string; expiresAt?: string },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    await this.billingService.overrideSubscription(orgId, {
      plan: body.plan,
      status: body.status,
      currentPeriodEnd: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'SUBSCRIPTION_OVERRIDE',
      targetType: 'org',
      targetId: orgId,
      reason: `Plan: ${body.plan}, Status: ${body.status}`,
    });
    return { success: true };
  }

  @Get('billing/revenue-by-plan')
  @Roles('ADMIN')
  async getRevenueByPlan(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.billingService.getRevenueByPlan();
  }

  // ─── Feature Flags ────────────────────────────────

  @Get('features')
  @Roles('ADMIN')
  async getFeatureFlags(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.featureFlagService.getAllFlags();
  }

  @Get('features/:key')
  @Roles('ADMIN')
  async getFeatureFlag(@Request() req: { user: RequestUser }, @Param('key') key: string) {
    await this.requireGlobalAdmin(req.user.id);
    return this.featureFlagService.getFlag(key);
  }

  @Patch('features/:key')
  @Roles('ADMIN')
  async setFeatureFlag(
    @Request() req: { user: RequestUser },
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.requireGlobalAdmin(req.user.id);
    const result = await this.featureFlagService.setFlag(key, body as any);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'FEATURE_FLAG_CHANGE',
      targetType: 'system',
      targetId: key,
      reason: `Updated: ${JSON.stringify(body)}`,
    });
    return result;
  }

  @Post('features/:key/toggle')
  @Roles('ADMIN')
  async toggleFeatureFlag(
    @Request() req: { user: RequestUser },
    @Param('key') key: string,
    @Body() body: { enabled: boolean },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    const result = await this.featureFlagService.toggleFlag(key, body.enabled);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'FEATURE_FLAG_CHANGE',
      targetType: 'system',
      targetId: key,
      reason: `Toggled to ${body.enabled}`,
    });
    return result;
  }

  @Get('features/config/system')
  @Roles('ADMIN')
  async getSystemConfig(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.featureFlagService.getSystemConfig();
  }

  @Patch('features/config/system')
  @Roles('ADMIN')
  async updateSystemConfig(
    @Request() req: { user: RequestUser },
    @Body() body: Record<string, unknown>,
  ) {
    await this.requireGlobalAdmin(req.user.id);
    const result = await this.featureFlagService.updateSystemConfig(body as any);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'SYSTEM_CONFIG_CHANGE',
      targetType: 'system',
      targetId: 'system',
      reason: `Updated: ${JSON.stringify(body)}`,
    });
    return result;
  }

  // ─── Platform Observability ───────────────────────

  @Get('observability/health')
  @Roles('ADMIN')
  async getSystemHealth(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.observabilityService.getSystemHealth();
  }

  @Get('observability/stuck-executions')
  @Roles('ADMIN')
  async getStuckExecutions(
    @Request() req: { user: RequestUser },
    @Query('thresholdMinutes') thresholdMinutes = '30',
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.observabilityService.getStuckExecutions(parseInt(thresholdMinutes, 10));
  }

  @Post('observability/stuck-executions/:id/cancel')
  @Roles('ADMIN')
  async cancelStuckExecution(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    await this.requireGlobalAdmin(req.user.id);
    await this.observabilityService.cancelStuckExecution(id);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'SYSTEM_CONFIG_CHANGE',
      targetType: 'system',
      targetId: id,
      reason: 'Cancelled stuck execution',
    });
    return { success: true };
  }

  @Get('observability/queue-stats')
  @Roles('ADMIN')
  async getQueueStats(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.observabilityService.getQueueStats();
  }

  @Get('observability/metrics')
  @Roles('ADMIN')
  async getPlatformMetrics(
    @Request() req: { user: RequestUser },
    @Query('days') days = '7',
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.observabilityService.getPlatformMetrics(parseInt(days, 10));
  }

  // ─── Moderation ───────────────────────────────────

  @Post('moderation/orgs/:id/block')
  @Roles('ADMIN')
  async blockOrg(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() body: { reason: string; severity?: 'high' | 'critical' },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    await this.moderationService.blockOrg(id, body.reason, body.severity);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'ORG_BAN',
      targetType: 'org',
      targetId: id,
      reason: body.reason,
    });
    return { success: true };
  }

  @Post('moderation/orgs/:id/unblock')
  @Roles('ADMIN')
  async unblockOrg(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    await this.requireGlobalAdmin(req.user.id);
    await this.moderationService.unblockOrg(id);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'ORG_UNBAN',
      targetType: 'org',
      targetId: id,
      reason: 'Organization unblocked',
    });
    return { success: true };
  }

  @Get('moderation/orgs/blocked')
  @Roles('ADMIN')
  async getBlockedOrgs(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.moderationService.getBlockedOrgs();
  }

  @Post('moderation/users/:id/block')
  @Roles('ADMIN')
  async blockUser(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    await this.moderationService.blockUser(id, body.reason);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'USER_SUSPEND',
      targetType: 'user',
      targetId: id,
      reason: body.reason,
    });
    return { success: true };
  }

  @Post('moderation/users/:id/unblock')
  @Roles('ADMIN')
  async unblockUser(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    await this.requireGlobalAdmin(req.user.id);
    await this.moderationService.unblockUser(id);
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'USER_UNSUSPEND',
      targetType: 'user',
      targetId: id,
      reason: 'User unblocked',
    });
    return { success: true };
  }

  @Get('moderation/users/blocked')
  @Roles('ADMIN')
  async getBlockedUsers(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.moderationService.getBlockedUsers();
  }

  @Post('moderation/rate-limit')
  @Roles('ADMIN')
  async setRateLimit(
    @Request() req: { user: RequestUser },
    @Body() body: {
      targetType: string;
      targetId: string;
      requestsPerMinute?: number;
      requestsPerHour?: number;
      requestsPerDay?: number;
      agentExecutionsPerHour?: number;
      durationMinutes?: number;
    },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    const targetType = body.targetType.toLowerCase() as 'org' | 'user';
    await this.moderationService.setRateLimit(
      targetType,
      body.targetId,
      {
        requestsPerMinute: body.requestsPerMinute,
        requestsPerHour: body.requestsPerHour,
        requestsPerDay: body.requestsPerDay,
        agentExecutionsPerHour: body.agentExecutionsPerHour,
      },
      body.durationMinutes,
    );
    await this.auditService.logAction({
      adminId: req.user.id,
      action: 'RATE_LIMIT_OVERRIDE',
      targetType: targetType,
      targetId: body.targetId,
      reason: 'Rate limits updated',
    });
    return { success: true };
  }

  @Get('moderation/rate-limit')
  @Roles('ADMIN')
  async getRateLimit(
    @Request() req: { user: RequestUser },
    @Query('targetType') targetType: string,
    @Query('targetId') targetId: string,
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.moderationService.getRateLimit(targetType, targetId);
  }

  @Post('moderation/suspicious-activity/detect')
  @Roles('ADMIN')
  async detectSuspiciousActivity(
    @Request() req: { user: RequestUser },
    @Body() body: { orgId?: string; hours?: number },
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.moderationService.detectSuspiciousActivity(body.orgId, body.hours);
  }

  @Get('moderation/log')
  @Roles('ADMIN')
  async getModerationLog(@Request() req: { user: RequestUser }) {
    await this.requireGlobalAdmin(req.user.id);
    return this.moderationService.getModerationLog();
  }

  // ─── Audit Log ────────────────────────────────────

  @Get('audit')
  @Roles('ADMIN')
  async getAuditLog(
    @Request() req: { user: RequestUser },
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('adminId') adminId?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.auditService.getAuditLog(
      {
        adminId,
        action,
        targetType,
        targetId,
        startDate: from ? new Date(from) : undefined,
        endDate: to ? new Date(to) : undefined,
      },
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  @Get('audit/stats')
  @Roles('ADMIN')
  async getAdminStats(
    @Request() req: { user: RequestUser },
    @Query('adminId') adminId?: string,
    @Query('days') days = '30',
  ) {
    await this.requireGlobalAdmin(req.user.id);
    return this.auditService.getAdminStats(adminId || req.user.id, parseInt(days, 10));
  }
}
