import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET is required in production'); })() : 'agems-dev-secret'),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
