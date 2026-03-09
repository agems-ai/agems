import { Controller, Post, BadRequestException } from '@nestjs/common';
import { Public } from '../../common/decorators/roles.decorator';
import Stripe from 'stripe';

@Controller('stripe')
export class StripeController {
  private stripe: Stripe | null = null;

  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      this.stripe = new Stripe(key);
    }
  }

  @Post('checkout')
  @Public()
  async createCheckout() {
    if (!this.stripe) throw new BadRequestException('Stripe not configured');
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'AGEMS Enterprise Setup',
              description: 'Up to 3 hours of hands-on setup with an AGEMS expert',
            },
            unit_amount: 98000,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.WEB_URL || 'http://localhost:3000'}/enterprise?success=true`,
      cancel_url: `${process.env.WEB_URL || 'http://localhost:3000'}/enterprise`,
    });

    return { url: session.url };
  }
}
