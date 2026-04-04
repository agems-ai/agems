import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuditService } from './admin-audit.service';
import { TenantManagementService } from './tenant-management.service';
import { BillingManagementService } from './billing-management.service';
import { FeatureFlagService } from './feature-flag.service';
import { PlatformObservabilityService } from './platform-observability.service';
import { ModerationService } from './moderation.service';

@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminAuditService,
    TenantManagementService,
    BillingManagementService,
    FeatureFlagService,
    PlatformObservabilityService,
    ModerationService,
  ],
  exports: [
    AdminService,
    AdminAuditService,
    TenantManagementService,
    BillingManagementService,
    FeatureFlagService,
    PlatformObservabilityService,
    ModerationService,
  ],
})
export class AdminModule {}
