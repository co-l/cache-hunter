import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type ProxyStatus, type Config, type SessionMeta, type TreeData } from './hooks/useApi';
import { HashGrid } from './components/HashGrid';
import { useWebSocket } from './hooks/useWebSocket';
import './styles/app.css';

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [editingConfig, setEditingConfig] = useState(false);
  const [editHost, setEditHost] = useState('');
  const [editPort, setEditPort] = useState('');
  const [status, setStatus] = useState<ProxyStatus>({ running: false, capturing: false, activeModel: null });
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [gridData, setGridData] = useState<TreeData | null>(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  }, []);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => showError('Failed to load config'));
    pollStatus();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const pollStatus = useCallback(() => {
    const refresh = () => {
      api.proxyStatus().then(setStatus).catch(() => {});
      api.listSessions().then(s => setSessions(s.sessions)).catch(() => {});
    };
    refresh();
    pollingRef.current = setInterval(refresh, 2000);
  }, []);

  const getActiveSessionId = useCallback((): string | null => {
    const active = sessions.find(s => s.status === 'active');
    return active?.id || null;
  }, [sessions]);

  const loadGrid = useCallback(async (id: string, incremental = false) => {
    if (!incremental) setGridLoading(true)
    try {
      const data = await api.getSessionGrid(id)
      setGridData(data)
    } catch {
      if (!incremental) setGridData(null)
    } finally {
      if (!incremental) setGridLoading(false)
    }
  }, [])

  const activeSessionId = getActiveSessionId();

  useWebSocket({
    'request:received': () => {
      if (selectedSessionId && selectedSessionId === activeSessionId) {
        loadGrid(selectedSessionId, true)
      }
    },
    'session:updated': () => {
      api.listSessions().then(s => setSessions(s.sessions)).catch(() => {});
    },
    'capture:start': (msg) => {
      const session = (msg as any).session;
      if (session) {
        setSelectedSessionId(session.id);
        loadGrid(session.id);
      }
      api.proxyStatus().then(setStatus).catch(() => {});
    },
    'capture:stop': () => {
      api.proxyStatus().then(setStatus).catch(() => {});
      api.listSessions().then(s => setSessions(s.sessions)).catch(() => {});
    },
  });

  const handleStartProxy = async () => {
    try {
      await api.proxyStart();
      await pollStatus();
    } catch (err: any) {
      showError(err.message || 'Failed to start proxy');
    }
  };

  const handleStopProxy = async () => {
    try {
      await api.proxyStop();
      setSelectedSessionId(null);
      setGridData(null);
      await pollStatus();
    } catch (err: any) {
      showError(err.message || 'Failed to stop proxy');
    }
  };

  const handleStartCapture = async () => {
    try {
      await api.captureStart();
      await pollStatus();
      const active = getActiveSessionId();
      if (active) {
        setSelectedSessionId(active);
        loadGrid(active);
      }
    } catch (err: any) {
      showError(err.message || 'Failed to start capture');
    }
  };

  const handleStopCapture = async () => {
    try {
      await api.captureStop();
      await pollStatus();
    } catch (err: any) {
      showError(err.message || 'Failed to stop capture');
    }
  };

  const handleSelectSession = async (id: string) => {
    setSelectedSessionId(id);
    await loadGrid(id);
  };

  const handleDeleteSession = async (id: string) => {
    if (!window.confirm('Delete this session permanently?')) return;
    try {
      await api.deleteSession(id);
      if (selectedSessionId === id) {
        setSelectedSessionId(null);
        setGridData(null);
      }
      await pollStatus();
    } catch (err: any) {
      showError(err.message || 'Failed to delete session');
    }
  };

  const handleStartRename = (session: SessionMeta) => {
    setRenamingSessionId(session.id);
    setRenameInput(session.name || formatTime(session.created_at));
  };

  const handleRenameConfirm = async () => {
    if (!renamingSessionId) return;
    try {
      await api.renameSession(renamingSessionId, renameInput);
      setRenamingSessionId(null);
      setRenameInput('');
      await pollStatus();
    } catch (err: any) {
      showError(err.message || 'Failed to rename session');
    }
  };

  const handleRenameCancel = () => {
    setRenamingSessionId(null);
    setRenameInput('');
  };

  const handleSaveConfig = () => {
    api.updateConfig({ targetHost: editHost, targetPort: parseInt(editPort, 10) }).then(c => {
      setConfig(c);
      setEditingConfig(false);
    }).catch(() => showError('Failed to save config'));
  };

  const startEditingConfig = () => {
    if (config) {
      setEditHost(config.targetHost);
      setEditPort(String(config.targetPort));
    }
    setEditingConfig(true);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDuration = (session: SessionMeta) => {
    if (!session.ended_at) return 'ongoing';
    const ms = session.ended_at - session.created_at;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m${secs}s`;
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="brand">Cache Hunter</span>
        </div>
        <div className="header-center">
          {config && !editingConfig && (
            <span className="target-url" onClick={startEditingConfig} title="Click to edit target">
              {config.targetHost}:{config.targetPort}
              <span className="edit-icon">✎</span>
            </span>
          )}
          {config && editingConfig && (
            <span className="target-url editing">
              <input
                className="host-input"
                value={editHost}
                onChange={e => setEditHost(e.target.value)}
                disabled={status.running}
                title={status.running ? 'Stop proxy to change target' : ''}
                placeholder="host"
              />
              <span className="sep">:</span>
              <input
                className="port-input"
                value={editPort}
                onChange={e => setEditPort(e.target.value)}
                disabled={status.running}
                title={status.running ? 'Stop proxy to change target' : ''}
                placeholder="port"
              />
              <button className="small primary" onClick={handleSaveConfig} disabled={status.running}>✓</button>
              <button className="small" onClick={() => setEditingConfig(false)} disabled={status.running}>✗</button>
            </span>
          )}
        </div>
        <div className="header-right">
          {!status.running ? (
            <button className="primary" onClick={handleStartProxy}>▶ Start Proxy</button>
          ) : (
            <button className="danger" onClick={handleStopProxy}>■ Stop Proxy</button>
          )}
        </div>
      </header>

      {error && <div className="toast-error">{error}</div>}

      <div className="main">
        <aside className="sidebar">
          <div className="sidebar-section">
            {!status.capturing ? (
              <button
                className="primary capture-btn"
                onClick={handleStartCapture}
                disabled={!status.running}
                title={!status.running ? 'Start proxy first' : ''}
              >
                ▶ Start Capture
              </button>
            ) : (
              <button className="danger capture-btn" onClick={handleStopCapture}>
                ■ Stop Capture
              </button>
            )}
          </div>

          <div className="sidebar-section sessions-section">
            <div className="section-title">Sessions</div>
            <div className="session-list">
              {sessions.map(s => (
                <div
                  key={s.id}
                  className={`session-item ${selectedSessionId === s.id ? 'selected' : ''} ${s.status === 'active' ? 'active' : ''}`}
                  onClick={() => handleSelectSession(s.id)}
                >
                  <div className="session-info">
                    {renamingSessionId === s.id ? (
                      <span className="session-rename">
                        <input
                          className="rename-input"
                          value={renameInput}
                          onChange={e => setRenameInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameConfirm()
                            if (e.key === 'Escape') handleRenameCancel()
                          }}
                          onBlur={handleRenameConfirm}
                          autoFocus
                          onClick={e => e.stopPropagation()}
                        />
                      </span>
                    ) : (
                      <span className="session-name" onClick={e => { e.stopPropagation(); handleStartRename(s) }}>
                        {s.name || formatTime(s.created_at)}
                        <span className="rename-icon">✎</span>
                      </span>
                    )}
                    <span className="session-count">{s.request_count} req · {formatDuration(s)}</span>
                  </div>
                  <div className="session-actions">
                    {s.status === 'active' && <span className="live-badge">●</span>}
                    <button
                      className="small danger"
                      onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                      title="Delete session permanently"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="empty-state">No sessions yet</div>
              )}
            </div>
          </div>
        </aside>

        <main className="content">
          {gridLoading && <div className="loading">Loading...</div>}
          {!gridLoading && gridData && selectedSessionId && (
            <HashGrid
              data={gridData}
              autoScroll={autoScroll}
              onDeleteColumn={async (colIndex) => {
                try {
                  await api.deleteSessionCall(selectedSessionId, colIndex)
                  loadGrid(selectedSessionId)
                } catch (err: any) {
                  showError(err.message || 'Failed to delete call')
                }
              }}
            />
          )}
          {!gridLoading && !gridData && (
            <div className="empty-state centered">
              <div className="empty-title">Select a session to view</div>
              <div className="empty-sub">Or start capturing to see live traffic</div>
            </div>
          )}
        </main>
      </div>

      <footer className="status-bar">
        <span className={`status-indicator ${status.running ? 'online' : 'offline'}`}>
          Proxy: {status.running ? '● Running' : '○ Stopped'}
        </span>
        <span className="sep">|</span>
        <span className={`status-indicator ${status.capturing ? 'online' : 'offline'}`}>
          Capture: {status.capturing ? '● Active' : '○ Idle'}
        </span>
        {status.activeModel && (
          <>
            <span className="sep">|</span>
            <span className="status-model">{status.activeModel}</span>
          </>
        )}
        {sessions.find(s => s.status === 'active') && (
          <>
            <span className="sep">|</span>
            <span className="status-count">
              {sessions.find(s => s.status === 'active')!.request_count} requests
            </span>
          </>
        )}
        <label className="auto-scroll-label">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
          />
          Auto-scroll view
        </label>
      </footer>
    </div>
  );
}
