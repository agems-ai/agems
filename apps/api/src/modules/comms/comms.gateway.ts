import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CommsService } from './comms.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PrismaService } from '../../config/prisma.service';

@WebSocketGateway({ cors: { origin: process.env.WEB_URL || 'http://localhost:3000', credentials: true }, namespace: '/comms' })
export class CommsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private clients = new Map<string, { userId: string; orgId: string; socket: Socket }>();

  constructor(
    private jwtService: JwtService,
    private commsService: CommsService,
    @Inject(forwardRef(() => ApprovalsService))
    private approvalsService: ApprovalsService,
    private events: EventEmitter2,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = this.jwtService.verify(token);
      this.clients.set(client.id, { userId: payload.sub, orgId: payload.orgId, socket: client });
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.clients.delete(client.id);
  }

  @SubscribeMessage('join_channel')
  async handleJoinChannel(@ConnectedSocket() client: Socket, @MessageBody() data: { channelId: string }) {
    const clientInfo = this.clients.get(client.id);
    if (!clientInfo) return;
    const channel = await this.prisma.channel.findUnique({ where: { id: data.channelId }, select: { orgId: true } });
    if (!channel || channel.orgId !== clientInfo.orgId) return;
    client.join(`channel:${data.channelId}`);
    return { event: 'joined', channelId: data.channelId };
  }

  @SubscribeMessage('leave_channel')
  handleLeaveChannel(@ConnectedSocket() client: Socket, @MessageBody() data: { channelId: string }) {
    client.leave(`channel:${data.channelId}`);
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(@ConnectedSocket() client: Socket, @MessageBody() data: { channelId: string; content: string; contentType?: string }) {
    const clientInfo = this.clients.get(client.id);
    if (!clientInfo) return;

    const channel = await this.prisma.channel.findUnique({ where: { id: data.channelId }, select: { orgId: true } });
    if (!channel || channel.orgId !== clientInfo.orgId) return;

    const message = await this.commsService.sendMessage(
      data.channelId,
      { content: data.content, contentType: (data.contentType as any) || 'TEXT' },
      'HUMAN',
      clientInfo.userId,
    );

    return message;
  }

  @OnEvent('message.new')
  handleMessageBroadcast(payload: { channelId: string; message: any }) {
    this.server.to(`channel:${payload.channelId}`).emit('new_message', payload.message);
  }

  // ── Approval Actions ──

  @SubscribeMessage('approval_action')
  async handleApprovalAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { approvalId: string; action: 'approve' | 'reject'; reason?: string },
  ) {
    const clientInfo = this.clients.get(client.id);
    if (!clientInfo) return;

    // Verify approval belongs to user's org (ApprovalRequest has no orgId — check via agent relation)
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id: data.approvalId },
      select: { id: true, agent: { select: { orgId: true } } },
    });
    if (!approval || approval.agent.orgId !== clientInfo.orgId) return;

    if (data.action === 'approve') {
      await this.approvalsService.resolveRequest(data.approvalId, 'APPROVED', 'HUMAN', clientInfo.userId);
    } else {
      await this.approvalsService.resolveRequest(data.approvalId, 'REJECTED', 'HUMAN', clientInfo.userId, data.reason);
    }
  }

  // ── Stop Agent Execution ──

  @SubscribeMessage('stop_execution')
  async handleStopExecution(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channelId: string; executionId?: string },
  ) {
    const clientInfo = this.clients.get(client.id);
    if (!clientInfo) return;
    if (data.channelId) {
      const channel = await this.prisma.channel.findUnique({ where: { id: data.channelId }, select: { orgId: true } });
      if (!channel || channel.orgId !== clientInfo.orgId) return;
    }
    this.events.emit('agent.execution.stop', { channelId: data.channelId, executionId: data.executionId });
  }

  // ── Agent Execution Live Updates ──

  @OnEvent('agent.execution.start')
  handleExecutionStart(payload: { channelId: string; agentId: string; agentName: string; executionId: string }) {
    if (payload.channelId) {
      this.server.to(`channel:${payload.channelId}`).emit('agent_thinking', {
        channelId: payload.channelId,
        agentId: payload.agentId,
        agentName: payload.agentName,
        executionId: payload.executionId,
        status: 'thinking',
      });
    }
  }

  @OnEvent('agent.tool.start')
  handleToolStart(payload: { channelId: string; agentId: string; agentName: string; executionId: string; toolName: string; toolInput: any }) {
    if (payload.channelId) {
      this.server.to(`channel:${payload.channelId}`).emit('agent_tool_update', {
        channelId: payload.channelId,
        agentId: payload.agentId,
        agentName: payload.agentName,
        executionId: payload.executionId,
        toolName: payload.toolName,
        toolInput: payload.toolInput,
        status: 'running',
      });
    }
  }

  @OnEvent('agent.tool.complete')
  handleToolComplete(payload: { channelId: string; agentId: string; agentName: string; executionId: string; toolName: string; durationMs: number; error?: string }) {
    if (payload.channelId) {
      this.server.to(`channel:${payload.channelId}`).emit('agent_tool_update', {
        channelId: payload.channelId,
        agentId: payload.agentId,
        agentName: payload.agentName,
        executionId: payload.executionId,
        toolName: payload.toolName,
        status: payload.error ? 'error' : 'completed',
        durationMs: payload.durationMs,
        error: payload.error,
      });
    }
  }

  @OnEvent('agent.thinking.chunk')
  handleThinkingChunk(payload: { channelId: string; agentId: string; executionId: string; chunk: string }) {
    if (payload.channelId) {
      this.server.to(`channel:${payload.channelId}`).emit('agent_thinking_chunk', {
        channelId: payload.channelId,
        agentId: payload.agentId,
        executionId: payload.executionId,
        chunk: payload.chunk,
      });
    }
  }

  @OnEvent('agent.text.chunk')
  handleTextChunk(payload: { channelId: string; agentId: string; executionId: string; chunk: string }) {
    if (payload.channelId) {
      this.server.to(`channel:${payload.channelId}`).emit('agent_text_chunk', {
        channelId: payload.channelId,
        agentId: payload.agentId,
        executionId: payload.executionId,
        chunk: payload.chunk,
      });
    }
  }

  @OnEvent('agent.execution.done')
  handleExecutionDone(payload: { channelId: string; agentId: string; executionId: string }) {
    if (payload.channelId) {
      this.server.to(`channel:${payload.channelId}`).emit('agent_thinking', {
        channelId: payload.channelId,
        agentId: payload.agentId,
        executionId: payload.executionId,
        status: 'done',
      });
    }
  }

  @OnEvent('approval.requested')
  handleApprovalRequested(request: any) {
    this.server.emit('approval_new', request);
    if (request.channelId) {
      this.server.to(`channel:${request.channelId}`).emit('approval_new', request);
    }
  }

  @OnEvent('approval.resolved')
  async handleApprovalResolved(payload: { request: any; status: string }) {
    this.server.emit('approval_resolved', payload);
    if (payload.request.channelId) {
      this.server.to(`channel:${payload.request.channelId}`).emit('approval_resolved', payload);
    }
    // Broadcast updated pending count
    const count = await this.approvalsService.getPendingCount();
    this.server.emit('approval_count', { count });
  }
}
