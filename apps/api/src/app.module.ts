import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './config/prisma.module';
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
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
