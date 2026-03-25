import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CommsController } from './comms.controller';
import { FilesController } from './files.controller';
import { CommsService } from './comms.service';
import { CommsGateway } from './comms.gateway';
import { ApprovalsModule } from '../approvals/approvals.module';
import { requireEnv } from '../../config/env.util';

@Module({
  imports: [
    JwtModule.register({
      secret: requireEnv('JWT_SECRET'),
      signOptions: { expiresIn: '7d' },
    }),
    forwardRef(() => ApprovalsModule),
  ],
  controllers: [CommsController, FilesController],
  providers: [CommsService, CommsGateway],
  exports: [CommsService],
})
export class CommsModule {}
