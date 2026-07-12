import { useEffect, useRef } from 'react';

type MessageHandler = (data: Record<string, unknown>) => void;

export function useWebSocket(handlers: Record<string, MessageHandler>): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[WS] Connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const handler = handlersRef.current[msg.type];
          if (handler) handler(msg);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        ws = null;
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        if (ws) ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    };
  }, []);
}
