import { Module } from '@nestjs/common';
import { StripeController } from './stripe.controller';

@Module({
  controllers: [StripeController],
})
export class StripeModule {}
