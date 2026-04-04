'use client';

import { io, Socket } from 'socket.io-client';
import { api } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

let commsSocket: Socket | null = null;
let meetingsSocket: Socket | null = null;

const isViewerMode = process.env.NEXT_PUBLIC_PUBLIC_MODE === 'viewer';

export function getCommsSocket(): Socket {
  if (!commsSocket) {
    const token = api.getToken();
    commsSocket = io(`${API_URL}/comms`, {
      ...(token ? { auth: { token } } : {}),
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1000,
    });
  }
  return commsSocket;
}

export function getMeetingsSocket(): Socket {
  if (!meetingsSocket) {
    const token = api.getToken();
    meetingsSocket = io(`${API_URL}/meetings`, {
      ...(token ? { auth: { token } } : {}),
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
