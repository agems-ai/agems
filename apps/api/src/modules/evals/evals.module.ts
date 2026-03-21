import { Module } from '@nestjs/common';
import { EvalsController } from './evals.controller';
import { EvalsService } from './evals.service';

@Module({
  controllers: [EvalsController],
  providers: [EvalsService],
  exports: [EvalsService],
})
export class EvalsModule {}
