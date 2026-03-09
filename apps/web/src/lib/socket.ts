'use client';

import { io, Socket } from 'socket.io-client';
import { api } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

let commsSocket: Socket | null = null;
let meetingsSocket: Socket | null = null;

export function getCommsSocket(): Socket {
  if (!commsSocket) {
    commsSocket = io(`${API_URL}/comms`, {
      auth: { token: api.getToken() },
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1000,
    });
  }
  return commsSocket;
}

export function getMeetingsSocket(): Socket {
  if (!meetingsSocket) {
    meetingsSocket = io(`${API_URL}/meetings`, {
      auth: { token: api.getToken() },
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1000,
    });
  }
  return meetingsSocket;
}

export function disconnectAll() {
  commsSocket?.disconnect();
  commsSocket = null;
  meetingsSocket?.disconnect();
  meetingsSocket = null;
}
