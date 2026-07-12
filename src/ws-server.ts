import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

export interface WSBroadcaster {
  broadcast(type: string, payload?: Record<string, unknown>): void;
}

export function attachWSServer(server: HttpServer): WSBroadcaster {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  return {
    broadcast(type: string, payload?: Record<string, unknown>) {
      const message = JSON.stringify({ type, ...payload });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    },
  };
}
