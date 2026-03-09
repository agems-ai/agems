import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../config/prisma.service';
import type { CreateChannelInput, SendMessageInput } from '@agems/shared';

@Injectable()
export class CommsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async createChannel(
    input: CreateChannelInput,
    creatorType: 'AGENT' | 'HUMAN',
    creatorId: string,
    orgId: string,
  ) {
    // Filter out creator from participants to avoid unique constraint violation
    const filteredParticipants = input.participantIds.filter(
      (p) => !(p.type === creatorType && p.id === creatorId),
    );

    const channel = await this.prisma.channel.create({
      data: {
        orgId,
        name: input.name,
        type: input.type as any,
        participants: {
          create: [
            { participantType: creatorType, participantId: creatorId, role: 'ADMIN' },
            ...filteredParticipants.map((p) => ({
              participantType: p.type as any,
              participantId: p.id,
              role: 'MEMBER' as const,
            })),
          ],
        },
      },
      include: { participants: true },
    });

    this.events.emit('audit.create', {
      actorType: creatorType,
      actorId: creatorId,
      action: 'CREATE',
      resourceType: 'channel',
      resourceId: channel.id,
    });

    return channel;
  }

  async findAllChannels(participantId: string, orgId?: string) {
    return this.prisma.channel.findMany({
      where: {
        ...(orgId && { orgId }),
        participants: { some: { participantId } },
      },
      include: {
        participants: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAgentToAgentChannels(orgId: string) {
    // Find all channels where ALL participants are agents (no humans)
    const channels = await this.prisma.channel.findMany({
      where: {
        orgId,
        participants: { some: { participantType: 'AGENT' } },
        NOT: { participants: { some: { participantType: 'HUMAN' } } },
      },
      include: {
        participants: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Only return channels that have messages AND at least 2 agent participants (true A2A)
    return channels.filter(ch => {
      const agentParticipants = ch.participants.filter(p => p.participantType === 'AGENT');
      return ch._count.messages > 0 && agentParticipants.length >= 2;
    });
  }

  async findOneChannel(channelId: string, orgId?: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        participants: true,
        _count: { select: { messages: true } },
      },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    if (orgId && channel.orgId !== orgId) throw new ForbiddenException('Channel does not belong to this organization');
    return channel;
  }

  async sendMessage(
    channelId: string,
    input: SendMessageInput,
    senderType: 'AGENT' | 'HUMAN' | 'SYSTEM',
    senderId: string,
    orgId?: string,
  ) {
    await this.findOneChannel(channelId, orgId);

    const message = await this.prisma.message.create({
      data: {
        channelId,
        senderType: senderType as any,
        senderId,
        content: input.content,
        contentType: (input.contentType ?? 'TEXT') as any,
        metadata: input.metadata as any,
      },
    });

    this.events.emit('message.new', { channelId, message });

    this.events.emit('audit.create', {
      actorType: senderType,
      actorId: senderId,
      action: 'COMMUNICATE',
      resourceType: 'message',
      resourceId: message.id,
    });

    return message;
  }

  async getMessages(channelId: string, filters: { page?: number; pageSize?: number }) {
    const page = Number(filters.page) || 1;
    const pageSize = Number(filters.pageSize) || 50;

    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.message.count({ where: { channelId } }),
    ]);

    return { data: data.reverse(), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async addParticipant(channelId: string, participantType: string, participantId: string, role = 'MEMBER') {
    await this.findOneChannel(channelId);
    return this.prisma.channelParticipant.create({
      data: {
        channelId,
        participantType: participantType as any,
        participantId,
        role: role as any,
      },
    });
  }

  async removeParticipant(channelId: string, participantId: string) {
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId, participantId },
    });
    if (!participant) throw new NotFoundException('Participant not found');
    return this.prisma.channelParticipant.delete({ where: { id: participant.id } });
  }

  async updateChannel(channelId: string, input: { name?: string; metadata?: any }) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    return this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      },
      include: { participants: true, _count: { select: { messages: true } } },
    });
  }

  async deleteChannel(channelId: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');
    return this.prisma.channel.delete({ where: { id: channelId } });
  }

  // ── Auto-create DIRECT chats ──

  @OnEvent('agent.created')
  async onAgentCreated(payload: { id: string; name: string; orgId?: string }) {
    if (!payload.orgId) return;
    await this.createDirectChatsForNew('AGENT', payload.id, payload.name, payload.orgId);
  }

  @OnEvent('user.created')
  async onUserCreated(payload: { id: string; name: string; orgId?: string }) {
    if (!payload.orgId) return;
    await this.createDirectChatsForNew('HUMAN', payload.id, payload.name, payload.orgId);
  }

  private async createDirectChatsForNew(type: 'AGENT' | 'HUMAN', id: string, name: string, orgId: string) {
    const agents = await this.prisma.agent.findMany({
      where: orgId ? { orgId } : undefined,
      select: { id: true, name: true },
    });
    const users = await this.prisma.user.findMany({ select: { id: true, name: true } });

    const others: { type: 'AGENT' | 'HUMAN'; id: string; name: string }[] = [
      ...agents.filter((a) => !(type === 'AGENT' && a.id === id)).map((a) => ({ type: 'AGENT' as const, id: a.id, name: a.name })),
      ...users.filter((u) => !(type === 'HUMAN' && u.id === id)).map((u) => ({ type: 'HUMAN' as const, id: u.id, name: u.name })),
    ];

    for (const other of others) {
      const existing = await this.prisma.channel.findFirst({
        where: {
          type: 'DIRECT',
          AND: [
            { participants: { some: { participantType: type as any, participantId: id } } },
            { participants: { some: { participantType: other.type as any, participantId: other.id } } },
          ],
        },
      });
      if (!existing) {
        await this.prisma.channel.create({
          data: {
            orgId,
            name: `${name} & ${other.name}`,
            type: 'DIRECT',
            participants: {
              create: [
                { participantType: type as any, participantId: id, role: 'MEMBER' },
                { participantType: other.type as any, participantId: other.id, role: 'MEMBER' },
              ],
            },
          },
        });
      }
    }
  }

  async ensureAllDirectChats(orgId: string) {
    const agents = await this.prisma.agent.findMany({
      where: orgId ? { orgId } : undefined,
      select: { id: true, name: true },
    });
    const users = await this.prisma.user.findMany({ select: { id: true, name: true } });

    const participants: { type: 'AGENT' | 'HUMAN'; id: string; name: string }[] = [
      ...agents.map((a) => ({ type: 'AGENT' as const, id: a.id, name: a.name })),
      ...users.map((u) => ({ type: 'HUMAN' as const, id: u.id, name: u.name })),
    ];

    // Get all existing DIRECT channels
    const existingChannels = await this.prisma.channel.findMany({
      where: { type: 'DIRECT', ...(orgId && { orgId }) },
      include: { participants: true },
    });

    const existingPairs = new Set<string>();
    for (const ch of existingChannels) {
      if (ch.participants.length === 2) {
        const [p1, p2] = ch.participants;
        existingPairs.add(`${p1.participantType}:${p1.participantId}|${p2.participantType}:${p2.participantId}`);
        existingPairs.add(`${p2.participantType}:${p2.participantId}|${p1.participantType}:${p1.participantId}`);
      }
    }

    let created = 0;
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const p1 = participants[i];
        const p2 = participants[j];
        const key = `${p1.type}:${p1.id}|${p2.type}:${p2.id}`;
        if (!existingPairs.has(key)) {
          await this.prisma.channel.create({
            data: {
              orgId,
              name: `${p1.name} & ${p2.name}`,
              type: 'DIRECT',
              participants: {
                create: [
                  { participantType: p1.type as any, participantId: p1.id, role: 'MEMBER' },
                  { participantType: p2.type as any, participantId: p2.id, role: 'MEMBER' },
                ],
              },
            },
          });
          created++;
        }
      }
    }

    return { created, total: (participants.length * (participants.length - 1)) / 2, existing: existingChannels.length };
  }

  async findDirectChannel(type1: string, id1: string, type2: string, id2: string, orgId?: string) {
    return this.prisma.channel.findFirst({
      where: {
        type: 'DIRECT',
        ...(orgId && { orgId }),
        AND: [
          { participants: { some: { participantType: type1 as any, participantId: id1 } } },
          { participants: { some: { participantType: type2 as any, participantId: id2 } } },
        ],
      },
      include: { participants: true },
    });
  }

  async findAllDirectChannels(type1: string, id1: string, type2: string, id2: string, orgId?: string) {
    return this.prisma.channel.findMany({
      where: {
        type: 'DIRECT',
        ...(orgId && { orgId }),
        AND: [
          { participants: { some: { participantType: type1 as any, participantId: id1 } } },
          { participants: { some: { participantType: type2 as any, participantId: id2 } } },
        ],
      },
      include: {
        participants: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
