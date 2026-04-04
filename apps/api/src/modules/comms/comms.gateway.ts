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
  private agentOrgCache = new Map<string, string>(); // agentId → orgId

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
      client.join(`org:${payload.orgId}`);
      client.join(`user:${payload.sub}`);
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
    const participant = await this.prisma.channelParticipant.findFirst({
      where: {
        channelId: data.channelId,
        participantType: 'HUMAN',
        participantId: clientInfo.userId,
        channel: { orgId: clientInfo.orgId },
      },
      select: { id: true },
    });
    if (!participant) return;
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

    const message = await this.commsService.sendMessage(
      data.channelId,
      { content: data.content, contentType: (data.contentType as any) || 'TEXT' },
      'HUMAN',
      clientInfo.userId,
      clientInfo.orgId,
    );

    return message;
  }

  @OnEvent('message.new')
  async handleMessageBroadcast(payload: { channelId: string; message: any }) {
    this.server.to(`channel:${payload.channelId}`).emit('new_message', payload.message);

    // Notify human participants via user rooms (for multi-chat popups)
    // Exclude the sender so their own messages don't create popups
    const senderId = payload.message?.senderId;
    const senderType = payload.message?.senderType;
    const participants = await this.prisma.channelParticipant.findMany({
      where: { channelId: payload.channelId, participantType: 'HUMAN' },
      select: { participantId: true },
    });
    for (const p of participants) {
      if (senderType === 'HUMAN' && p.participantId === senderId) continue;
      this.server.to(`user:${p.participantId}`).emit('new_message_notification', {
        channelId: payload.channelId,
        message: payload.message,
      });
    }
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
      await this.approvalsService.resolveRequest(data.approvalId, 'APPROVED', 'HUMAN', clientInfo.userId, clientInfo.orgId);
    } else {
      await this.approvalsService.resolveRequest(data.approvalId, 'REJECTED', 'HUMAN', clientInfo.userId, clientInfo.orgId, data.reason);
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

  // ── Helpers ──

  /** Broadcast event to agent's org room (for Dashboard live feed) */
  private async broadcastToOrg(agentId: string, event: string, data: any) {
    try {
      let orgId = this.agentOrgCache.get(agentId);
      if (!orgId) {
        const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
        if (agent?.orgId) {
          orgId = agent.orgId;
          this.agentOrgCache.set(agentId, orgId);
        }
      }
      if (orgId) {
        this.server.to(`org:${orgId}`).emit(event, data);
      }
    } catch {}
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
  async handleToolStart(payload: { channelId: string; agentId: string; agentName: string; executionId: string; toolName: string; toolInput: any }) {
    const data = {
      channelId: payload.channelId,
      agentId: payload.agentId,
      agentName: payload.agentName,
      executionId: payload.executionId,
      toolName: payload.toolName,
      toolInput: payload.toolInput,
      status: 'running',
    };
    if (payload.channelId) {
      this.server.to(`channel:${payload.channelId}`).emit('agent_tool_update', data);
    }
    await this.broadcastToOrg(payload.agentId, 'agent_tool_update_org', data);
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
  async handleThinkingChunk(payload: { channelId: string; agentId: string; executionId: string; chunk: string }) {
    const data = {
      channelId: payload.channelId,
      agentId: payload.agentId,
      executionId: payload.executionId,
      chunk: payload.chunk,
    };
    if (payload.channelId) {
      this.server.to(`channel:${payload.channelId}`).emit('agent_thinking_chunk', data);
    }
    await this.broadcastToOrg(payload.agentId, 'agent_thinking_chunk_org', data);
  }

  @OnEvent('agent.text.chunk')
  async handleTextChunk(payload: { channelId: string; agentId: string; executionId: string; chunk: string }) {
    const data = {
      channelId: payload.channelId,
      agentId: payload.agentId,
      executionId: payload.executionId,
      chunk: payload.chunk,
    };
    if (payload.channelId) {
      this.server.to(`channel:${payload.channelId}`).emit('agent_text_chunk', data);
    }
    // Also broadcast to org room for Dashboard activity feed
    await this.broadcastToOrg(payload.agentId, 'agent_text_chunk_org', data);
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

  // ── Browser Screencast Live Frames ──

  @OnEvent('agent.browser.frame')
  async handleBrowserFrame(payload: { executionId: string; agentId: string; channelId?: string; frame: string; metadata: any }) {
    const data = {
      executionId: payload.executionId,
      agentId: payload.agentId,
      frame: payload.frame,
      metadata: payload.metadata,
    };
    // Broadcast to org room for dashboard Activity panel
    await this.broadcastToOrg(payload.agentId, 'agent_browser_frame', data);
  }

  @OnEvent('agent.browser.stop')
  async handleBrowserStop(payload: { executionId: string; agentId: string; channelId?: string }) {
    const data = { executionId: payload.executionId, agentId: payload.agentId };
    await this.broadcastToOrg(payload.agentId, 'agent_browser_stop', data);
  }

  @OnEvent('approval.requested')
  handleApprovalRequested(request: any) {
    this.server.to(`org:${request.agent?.orgId}`).emit('approval_new', request);
    if (request.channelId) {
      this.server.to(`channel:${request.channelId}`).emit('approval_new', request);
    }
  }

  @OnEvent('approval.resolved')
  async handleApprovalResolved(payload: { request: any; status: string }) {
    this.server.to(`org:${payload.request.agent?.orgId}`).emit('approval_resolved', payload);
    if (payload.request.channelId) {
      this.server.to(`channel:${payload.request.channelId}`).emit('approval_resolved', payload);
    }
    const orgId = payload.request.agent?.orgId;
    if (orgId) {
      const count = await this.approvalsService.getPendingCount(orgId);
      this.server.to(`org:${orgId}`).emit('approval_count', { count });
    }
  }
}
