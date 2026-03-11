import { Module } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';
import { DemoSeedService } from './demo-seed.service';

@Module({
  providers: [BootstrapService, DemoSeedService],
  exports: [BootstrapService, DemoSeedService],
})
export class BootstrapModule {}
