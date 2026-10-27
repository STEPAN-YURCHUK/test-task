import { io, type Socket } from 'socket.io-client';
import { API_URL } from './config';

let socket: Socket | null = null;

export function getCommentsSocket(): Socket {
  socket ??= io(`${API_URL}/comments`, { transports: ['websocket'], autoConnect: true });
  return socket;
}
