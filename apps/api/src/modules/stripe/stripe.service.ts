import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../config/prisma.service';

// Stripe Price IDs → Plan mapping
const PRICE_TO_PLAN: Record<string, { plan: 'STARTER' | 'PRO' | 'BUSINESS'; hours: number }> = {
  'price_1TAIT8J7Q6O5DJQlliL5k0Vk': { plan: 'STARTER', hours: 2 },
  'price_1TAIT9J7Q6O5DJQlMtZGhK2U': { plan: 'PRO', hours: 8 },
  'price_1TAIT9J7Q6O5DJQlj7pffatX': { plan: 'BUSINESS', hours: 16 },
};

@Injectable()
export class StripeService {
  private stripe: Stripe | null = null;
  private readonly logger = new Logger(StripeService.name);

  constructor(private prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) this.stripe = new Stripe(key);
  }

  getStripe(): Stripe | null {
    return this.stripe;
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    if (!this.stripe) throw new Error('Stripe not configured');
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    // SAFETY: filter non-AGEMS events for shared Stripe account
    const obj = event.data.object as any;
    const metadata = obj.metadata || {};

    // For checkout events, check session metadata
    // For subscription/invoice events, check via subscription metadata or price
    if (event.type === 'checkout.session.completed') {
      if (metadata.app !== 'agems') {
        this.logger.debug(`Ignoring non-AGEMS checkout ${obj.id}`);
        return;
      }
      await this.handleCheckoutCompleted(obj as Stripe.Checkout.Session);
      return;
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = obj as Stripe.Subscription;
      // Check if this subscription is ours by looking up in DB
      const existing = await this.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: sub.id },
      });
      if (!existing) {
        this.logger.debug(`Ignoring non-AGEMS subscription ${sub.id}`);
        return;
      }
      await this.handleSubscriptionUpdate(sub);
      return;
    }

    if (event.type === 'invoice.paid') {
      const invoice = obj as any;
      const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (subId) {
        const existing = await this.prisma.subscription.findUnique({
          where: { stripeSubscriptionId: subId },
        });
        if (!existing) return; // Not our subscription
        await this.handleInvoicePaid(invoice);
      }
      return;
    }

    // All other event types — silently acknowledge
  }

  // ── Checkout completed (subscription mode) ──

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const email = session.customer_email || session.metadata?.email;
    if (!email) {
      this.logger.error(`No email in session ${session.id}`);
      return;
    }

    // Idempotency
    const existing = await this.prisma.payment.findUnique({
      where: { stripeSessionId: session.id },
    });
    if (existing?.status === 'COMPLETED') return;

    // Find or create user + org
    const { user, orgId } = await this.findOrCreateUserAndOrg(email, session.metadata?.orgId);

    // Determine plan from subscription
    const plan = session.metadata?.plan as 'STARTER' | 'PRO' | 'BUSINESS' | undefined;
    const targetPlan = plan || 'STARTER';

    // Handle subscription mode
    if (session.mode === 'subscription' && session.subscription) {
      const subId = typeof session.subscription === 'string' ? session.subscription : (session.subscription as any).id;

      // Retrieve full subscription from Stripe
      const stripeSub = await this.stripe!.subscriptions.retrieve(subId);
      const priceId = stripeSub.items.data[0]?.price?.id;
      const planInfo = priceId ? PRICE_TO_PLAN[priceId] : null;

      await this.prisma.subscription.upsert({
        where: { orgId },
        create: {
          orgId,
          stripeSubscriptionId: subId,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
          stripePriceId: priceId || '',
          plan: planInfo?.plan || targetPlan,
          hoursPerMonth: planInfo?.hours || 0,
          status: 'active',
          currentPeriodStart: new Date((stripeSub as any).current_period_start * 1000),
          currentPeriodEnd: new Date((stripeSub as any).current_period_end * 1000),
        },
        update: {
          stripeSubscriptionId: subId,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
          stripePriceId: priceId || undefined,
          plan: planInfo?.plan || targetPlan,
          hoursPerMonth: planInfo?.hours || 0,
          status: 'active',
          currentPeriodStart: new Date((stripeSub as any).current_period_start * 1000),
          currentPeriodEnd: new Date((stripeSub as any).current_period_end * 1000),
          canceledAt: null,
        },
      });

      // Update org plan
      await this.prisma.organization.update({
        where: { id: orgId },
        data: { plan: planInfo?.plan || targetPlan },
      });

      this.logger.log(`Subscription created: ${email}, org ${orgId} → ${planInfo?.plan || targetPlan}`);
    }

    // Record payment
    await this.prisma.payment.upsert({
      where: { stripeSessionId: session.id },
      create: {
        stripeSessionId: session.id,
        stripePaymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        email,
        amount: session.amount_total || 0,
        currency: session.currency || 'usd',
        status: 'COMPLETED',
        product: `subscription_${targetPlan.toLowerCase()}`,
        orgId,
        metadata: { plan: targetPlan, sessionMetadata: session.metadata },
      },
      update: {
        status: 'COMPLETED',
        orgId,
      },
    });
  }

  // ── Subscription updated/canceled ──

  private async handleSubscriptionUpdate(sub: Stripe.Subscription) {
    const record = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: sub.id },
    });
    if (!record) return;

    const priceId = sub.items.data[0]?.price?.id;
    const planInfo = priceId ? PRICE_TO_PLAN[priceId] : null;

    const status = sub.status === 'active' ? 'active'
      : sub.status === 'canceled' ? 'canceled'
      : sub.status === 'past_due' ? 'past_due'
      : sub.status;

    await this.prisma.subscription.update({
      where: { stripeSubscriptionId: sub.id },
      data: {
        status,
        stripePriceId: priceId || undefined,
        plan: planInfo?.plan || record.plan,
        hoursPerMonth: planInfo?.hours ?? record.hoursPerMonth,
        currentPeriodStart: new Date((sub as any).current_period_start * 1000),
        currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      },
    });

    // Downgrade org plan if canceled
    if (status === 'canceled') {
      await this.prisma.organization.update({
        where: { id: record.orgId },
        data: { plan: 'FREE' },
      });
      this.logger.log(`Subscription canceled: org ${record.orgId} → FREE`);
    } else if (planInfo) {
      await this.prisma.organization.update({
        where: { id: record.orgId },
        data: { plan: planInfo.plan },
      });
    }
  }

  // ── Invoice paid (recurring) ──

  private async handleInvoicePaid(invoice: any) {
    const email = typeof invoice.customer_email === 'string' ? invoice.customer_email : '';
    if (!email) return;

    // Record as payment
    const sessionId = `invoice_${invoice.id}`;
    await this.prisma.payment.upsert({
      where: { stripeSessionId: sessionId },
      create: {
        stripeSessionId: sessionId,
        stripePaymentIntent: typeof invoice.payment_intent === 'string' ? invoice.payment_intent : null,
        email,
        amount: invoice.amount_paid || 0,
        currency: invoice.currency || 'usd',
        status: 'COMPLETED',
        product: 'subscription_renewal',
        metadata: { invoiceId: invoice.id },
      },
      update: { status: 'COMPLETED' },
    });
  }

  // ── Helper: find or create user and org ──

  private async findOrCreateUserAndOrg(email: string, metadataOrgId?: string): Promise<{ user: any; orgId: string }> {
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      const tempPassword = crypto.randomBytes(12).toString('base64url');
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      user = await this.prisma.user.create({
        data: { email, passwordHash, name: email.split('@')[0], role: 'ADMIN' },
      });
      this.logger.log(`Auto-registered user ${email} from Stripe payment`);
    }

    let orgId = metadataOrgId;

    if (orgId) {
      const membership = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: user.id } },
      });
      if (!membership) orgId = undefined;
    }

    if (!orgId) {
      const membership = await this.prisma.orgMember.findFirst({
        where: { userId: user.id },
        orderBy: { joinedAt: 'asc' },
      });

      if (membership) {
        orgId = membership.orgId;
      } else {
        const slug = `${email.split('@')[0]}-${Date.now().toString(36)}`.replace(/[^a-z0-9-]/g, '');
        const org = await this.prisma.organization.create({
          data: { name: `${email.split('@')[0]}'s Organization`, slug, plan: 'FREE' },
        });
        await this.prisma.orgMember.create({
          data: { orgId: org.id, userId: user.id, role: 'ADMIN' },
        });
        orgId = org.id;
      }
    }

    return { user, orgId: orgId! };
  }
}
