import { Module } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';

@Module({
  providers: [BootstrapService],
  exports: [BootstrapService],
})
export class BootstrapModule {}
