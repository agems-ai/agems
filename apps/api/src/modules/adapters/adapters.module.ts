import { Module } from '@nestjs/common';
import { AdaptersController } from './adapters.controller';
import { AdaptersService } from './adapters.service';

@Module({
  controllers: [AdaptersController],
  providers: [AdaptersService],
  exports: [AdaptersService],
})
export class AdaptersModule {}
