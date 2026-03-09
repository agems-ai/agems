import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: process.env.WEB_URL || 'http://localhost:3000', credentials: true }, namespace: '/meetings' })
export class MeetingsGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('join_meeting')
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { meetingId: string }) {
    client.join(`meeting:${data.meetingId}`);
    return { event: 'joined', meetingId: data.meetingId };
  }

  @SubscribeMessage('leave_meeting')
  handleLeave(@ConnectedSocket() client: Socket, @MessageBody() data: { meetingId: string }) {
    client.leave(`meeting:${data.meetingId}`);
  }

  @OnEvent('meeting.entry.new')
  handleNewEntry(payload: { meetingId: string; entry: any }) {
    this.server.to(`meeting:${payload.meetingId}`).emit('new_entry', payload.entry);
  }

  @OnEvent('meeting.vote.started')
  handleVoteStarted(payload: { meetingId: string; decisionId: string }) {
    this.server.to(`meeting:${payload.meetingId}`).emit('vote_started', payload);
  }

  @OnEvent('meeting.vote.tallied')
  handleVoteTallied(payload: { meetingId: string; decision: any }) {
    this.server.to(`meeting:${payload.meetingId}`).emit('vote_tallied', payload.decision);
  }

  @OnEvent('meeting.started')
  handleMeetingStarted(payload: { meetingId: string }) {
    this.server.to(`meeting:${payload.meetingId}`).emit('meeting_started', payload);
  }

  @OnEvent('meeting.agents.pending')
  handleAgentsPending(payload: { meetingId: string; count: number }) {
    this.server.to(`meeting:${payload.meetingId}`).emit('agents_pending', { count: payload.count });
  }
}
