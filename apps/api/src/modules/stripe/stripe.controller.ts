import { Controller, Post, Body, Req, Headers, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Public } from '../../common/decorators/roles.decorator';
import { StripeService } from './stripe.service';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('stripe')
@SkipThrottle()
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  constructor(
    private stripeService: StripeService,
    private jwtService: JwtService,
  ) {}

  // Plan → Stripe Price ID mapping
  private readonly PLAN_PRICES: Record<string, string> = {
    STARTER: 'price_1TAIT8J7Q6O5DJQlliL5k0Vk',
    PRO: 'price_1TAIT9J7Q6O5DJQlMtZGhK2U',
    BUSINESS: 'price_1TAIT9J7Q6O5DJQlj7pffatX',
  };

  @Post('checkout')
  @Public()
  async createCheckout(@Body() body: { token?: string; plan?: string }) {
    const stripe = this.stripeService.getStripe();
    if (!stripe) throw new BadRequestException('Stripe not configured');

    const plan = (body.plan || 'STARTER').toUpperCase();
    const priceId = this.PLAN_PRICES[plan];
    if (!priceId) throw new BadRequestException(`Invalid plan: ${body.plan}`);

    let email: string | undefined;
    let orgId: string | undefined;

    // If user is logged in, extract their info from JWT
    if (body.token) {
      try {
        const payload = this.jwtService.verify(body.token);
        email = payload.email;
        orgId = payload.orgId;
      } catch {
        // Invalid token — proceed without user context
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        app: 'agems',
        product: `subscription_${plan.toLowerCase()}`,
        plan,
        ...(orgId && { orgId }),
        ...(email && { email }),
      },
      success_url: `${process.env.WEB_URL || 'https://agems.ai'}/enterprise?success=true&type=subscription`,
      cancel_url: `${process.env.WEB_URL || 'https://agems.ai'}/enterprise`,
    });

    return { url: session.url };
  }

  @Post('webhook')
  @Public()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    if (!sig) throw new BadRequestException('Missing stripe-signature header');
    if (!req.rawBody) throw new BadRequestException('Missing raw body');

    let event;
    try {
      event = this.stripeService.verifyWebhookSignature(req.rawBody, sig);
    } catch (err: any) {
      this.logger.error(`Webhook signature failed: ${err.message}`);
      throw new BadRequestException('Webhook signature verification failed');
    }

    await this.stripeService.handleWebhookEvent(event);
    return { received: true };
  }
}
