import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { SecurityController } from './security.controller';

@Module({
  controllers: [SecurityController],
  providers: [AuditService],
  exports: [AuditService],
})
export class SecurityModule {}
