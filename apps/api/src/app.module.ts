import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './config/prisma.module';
import { RedisModule } from './config/redis.module';
import { RedisLockService } from './common/redis-lock.service';
import { AuthModule } from './modules/auth/auth.module';
import { AgentsModule } from './modules/agents/agents.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { CommsModule } from './modules/comms/comms.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { ToolsModule } from './modules/tools/tools.module';
import { SecurityModule } from './modules/security/security.module';
import { OrgModule } from './modules/org/org.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { SettingsModule } from './modules/settings/settings.module';
import { N8nModule } from './modules/n8n/n8n.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

import { ApprovalsModule } from './modules/approvals/approvals.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { CatalogModule } from './modules/catalog/catalog.module';

// New modules (Paperclip-inspired features)
import { GoalsModule } from './modules/goals/goals.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { AdaptersModule } from './modules/adapters/adapters.module';
import { PluginsModule } from './modules/plugins/plugins.module';
import { EvalsModule } from './modules/evals/evals.module';
import { WorktreesModule } from './modules/worktrees/worktrees.module';
import { ReposModule } from './modules/repos/repos.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,   // 1 second window
        limit: 10,   // 10 requests per second
      },
      {
        name: 'medium',
        ttl: 60000,  // 1 minute window
        limit: 200,  // 200 requests per minute
      },
    ]),
    PrismaModule,
    RedisModule,
    AuthModule,
    AgentsModule,
    TasksModule,
    CommsModule,
    MeetingsModule,
    ToolsModule,
    SecurityModule,
    OrgModule,
    RuntimeModule,
    SettingsModule,
    N8nModule,
    TelegramModule,
    DashboardModule,

    ApprovalsModule,
    StripeModule,
    CatalogModule,

    // New modules
    GoalsModule,
    ProjectsModule,
    BudgetsModule,
    AdaptersModule,
    PluginsModule,
    EvalsModule,
    WorktreesModule,
    ReposModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    RedisLockService,
  ],
})
export class AppModule {}
