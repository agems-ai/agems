import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';
import { requireEnv } from '../../config/env.util';

@Module({
  imports: [
    JwtModule.register({
      secret: requireEnv('JWT_SECRET'),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
