import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CommsController } from './comms.controller';
import { FilesController } from './files.controller';
import { CommsService } from './comms.service';
import { CommsGateway } from './comms.gateway';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET is required in production'); })() : 'agems-dev-secret'),
      signOptions: { expiresIn: '7d' },
    }),
    forwardRef(() => ApprovalsModule),
  ],
  controllers: [CommsController, FilesController],
  providers: [CommsService, CommsGateway],
  exports: [CommsService],
})
export class CommsModule {}
