const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export interface ProxyStatus {
  running: boolean;
  capturing: boolean;
  activeModel: string | null;
}

export interface Config {
  targetHost: string;
  targetPort: number;
  proxyPort: number;
}

export interface SessionMeta {
  id: string;
  filename: string;
  created_at: number;
  ended_at: number | null;
  status: 'active' | 'completed';
  model: string | null;
  request_count: number;
  target_host: string;
  target_port: number;
}

export interface TreeData {
  lines: string[][];
  hash_map: Record<string, string>;
  _grid: { rows: number; cols: number; cells: (string | null)[][] };
  _toolsHashes: (string | null)[];
}

export const api = {
  getConfig: () => request<Config>('/config'),
  updateConfig: (cfg: { targetHost?: string; targetPort?: number }) =>
    request<Config>('/config', { method: 'PUT', body: JSON.stringify(cfg) }),

  proxyStart: () => request<{ running: boolean }>('/proxy/start', { method: 'POST' }),
  proxyStop: () => request<{ running: boolean }>('/proxy/stop', { method: 'POST' }),
  proxyStatus: () => request<ProxyStatus>('/proxy/status'),

  captureStart: () => request<{ capturing: boolean; session: SessionMeta }>('/capture/start', { method: 'POST' }),
  captureStop: () => request<{ capturing: boolean }>('/capture/stop', { method: 'POST' }),

  listSessions: () => request<{ sessions: SessionMeta[] }>('/sessions'),
  getSessionGrid: (id: string) => request<TreeData>(`/sessions/${id}`),
  deleteSession: (id: string) => request<{ deleted: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
};
