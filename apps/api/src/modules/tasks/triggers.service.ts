import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID, randomBytes } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import { encryptJson, decryptJson } from '../../common/crypto.util';
import { verifyTrigger, type TriggerAuthConfig, type TriggerAuthKind } from './webhook-verify';

/**
 * TaskTrigger lifecycle: create / list / disable + signed-fire.
 *
 * Auth secrets are encrypted at rest via encryptJson() — same pattern
 * used for LLM API keys and other sensitive Settings. The plaintext is
 * returned ONCE at creation time so the caller (or webhook integration
 * setup wizard) can copy it; subsequent reads omit it.
 *
 * Fire path:
 *   1. Look up by slug
 *   2. Decrypt auth secret
 *   3. Verify signature / token via webhook-verify
 *   4. Set task.status = 'PENDING' so the scheduler picks it up
 *   5. Bump firingCount + lastFiredAt
 *   6. Emit audit + task.created-style event (handled by existing scheduler)
 */
@Injectable()
export class TriggersService {
  private readonly logger = new Logger(TriggersService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  /** Create a trigger. Returns the plaintext secret ONCE — never persisted. */
  async create(
    input: {
      taskId: string;
      kind?: 'WEBHOOK' | 'GMAIL' | 'N8N';
      authKind?: TriggerAuthKind;
      signatureHeader?: string;
      metadata?: Record<string, unknown>;
    },
    orgId: string,
    userId: string,
  ) {
    const task = await this.prisma.task.findUnique({ where: { id: input.taskId } });
    if (!task || task.orgId !== orgId) throw new NotFoundException('Task not found');

    const authKind = input.authKind ?? 'HMAC';
    let secret: string | null = null;
    let authSecretEnc: string | null = null;
    if (authKind !== 'NONE') {
      secret = randomBytes(32).toString('hex');
      authSecretEnc = encryptJson(secret);
    }

    const trigger = await this.prisma.taskTrigger.create({
      data: {
        orgId,
        taskId: input.taskId,
        slug: randomUUID(),
        kind: input.kind ?? 'WEBHOOK',
        authKind,
        authSecretEnc,
        signatureHeader: input.signatureHeader ?? null,
        metadata: input.metadata as any,
      },
    });

    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'CREATE',
      resourceType: 'task_trigger', resourceId: trigger.id, orgId,
    });

    // Plaintext secret returned ONCE here — caller is responsible for
    // copying it. We never return it again.
    return { ...trigger, secret };
  }

  /** List triggers for the calling org. Never includes secret. */
  async findAll(orgId: string, taskId?: string) {
    return this.prisma.taskTrigger.findMany({
      where: { orgId, ...(taskId && { taskId }) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, taskId: true, slug: true, kind: true, authKind: true,
        signatureHeader: true, enabled: true, lastFiredAt: true,
        firingCount: true, metadata: true, createdAt: true, updatedAt: true,
      },
    });
  }

  async setEnabled(id: string, enabled: boolean, orgId: string, userId: string) {
    const trigger = await this.prisma.taskTrigger.findUnique({ where: { id } });
    if (!trigger || trigger.orgId !== orgId) throw new NotFoundException('Trigger not found');
    const updated = await this.prisma.taskTrigger.update({
      where: { id },
      data: { enabled },
    });
    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'UPDATE',
      resourceType: 'task_trigger', resourceId: id, orgId,
      details: { enabled },
    });
    return updated;
  }

  async delete(id: string, orgId: string, userId: string) {
    const trigger = await this.prisma.taskTrigger.findUnique({ where: { id } });
    if (!trigger || trigger.orgId !== orgId) throw new NotFoundException('Trigger not found');
    await this.prisma.taskTrigger.delete({ where: { id } });
    this.events.emit('audit.create', {
      actorType: 'HUMAN', actorId: userId, action: 'DELETE',
      resourceType: 'task_trigger', resourceId: id, orgId,
    });
    return { ok: true };
  }

  /**
   * Fire a trigger by slug. PUBLIC endpoint (no JWT). Caller MUST pass
   * verified raw body bytes + headers — verifyTrigger does the rest.
   *
   * On success: task.status flips to PENDING and the existing
   * TaskScheduler picks it up on its next tick.
   */
  async fireBySlug(args: {
    slug: string;
    body: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<{ ok: boolean; taskId?: string; reason?: string }> {
    const trigger = await this.prisma.taskTrigger.findUnique({
      where: { slug: args.slug },
    });
    if (!trigger) return { ok: false, reason: 'not found' };
    if (!trigger.enabled) return { ok: false, reason: 'disabled' };

    // Reconstruct the auth config from the row.
    let secret: string | undefined;
    if (trigger.authSecretEnc) {
      try {
        secret = decryptJson(trigger.authSecretEnc) as string;
      } catch (err) {
        this.logger.error(`Failed to decrypt trigger ${trigger.id} secret: ${(err as Error).message}`);
        return { ok: false, reason: 'misconfigured' };
      }
    }
    const config: TriggerAuthConfig = {
      kind: trigger.authKind,
      secret,
      signatureHeader: trigger.signatureHeader ?? undefined,
    };

    const result = verifyTrigger({ config, body: args.body, headers: args.headers });
    if (!result.ok) {
      // Log the REASON, never echo it to the caller — that would help
      // attackers iterate on a partial guess.
      this.logger.warn(`Trigger ${trigger.id} rejected: ${result.reason}`);
      return { ok: false, reason: 'unauthorized' };
    }

    // Fire: move the task back to PENDING so the scheduler re-runs it.
    // For RECURRING tasks this is the standard reset path. For ONE_TIME
    // tasks that already completed the task is just bumped — the
    // scheduler will execute it again, which is what the caller asked
    // for by setting up a trigger in the first place.
    await this.prisma.$transaction([
      this.prisma.task.update({
        where: { id: trigger.taskId },
        data: { status: 'PENDING', lockedBy: null, lockedUntil: null },
      }),
      this.prisma.taskTrigger.update({
        where: { id: trigger.id },
        data: { lastFiredAt: new Date(), firingCount: { increment: 1 } },
      }),
    ]);

    this.events.emit('audit.create', {
      actorType: 'SYSTEM', actorId: 'task-trigger', action: 'EXECUTE',
      resourceType: 'task_trigger', resourceId: trigger.id, orgId: trigger.orgId,
      details: { taskId: trigger.taskId, slug: trigger.slug },
    });

    return { ok: true, taskId: trigger.taskId };
  }
}
