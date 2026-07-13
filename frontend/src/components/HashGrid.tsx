import { useState, useCallback, useRef, useEffect } from 'react';
import type { TreeData } from '../hooks/useApi';
import './HashGrid.css';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged' | 'changed';
  lineA: number | null;
  lineB: number | null;
  content: string;
}

export function HashGrid({ data, onDeleteColumn, autoScroll }: { data: TreeData; onDeleteColumn?: (colIndex: number) => void; autoScroll?: boolean }) {
  const { lines, hash_map } = data;
  const header = lines[0];
  const dataRows = lines.slice(1);
  const numCols = header.length;

  const [excludedCols, setExcludedCols] = useState<Set<number>>(new Set());
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);
  const [modalHash, setModalHash] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModalHash(null);
        setDiffOpen(false);
        setCompareA(null);
        setCompareB(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (autoScroll && gridRef.current) {
      const el = gridRef.current
      el.scrollLeft = el.scrollWidth - el.clientWidth
      el.scrollTop = el.scrollHeight - el.clientHeight
    }
  }, [data, autoScroll])

  const toggleExclude = useCallback((colIdx: number) => {
    setExcludedCols(prev => {
      const next = new Set(prev);
      if (next.has(colIdx)) next.delete(colIdx);
      else next.add(colIdx);
      return next;
    });
  }, []);

  const isDiffCell = useCallback((rowIdx: number, colIdx: number): boolean => {
    const cellHash = dataRows[rowIdx][colIdx]?.trim();
    if (!cellHash) return false;

    const nonExcluded: number[] = [];
    for (let c = 0; c < numCols; c++) {
      if (!excludedCols.has(c)) nonExcluded.push(c);
    }

    const prevNonExcluded = nonExcluded.filter(c => c < colIdx);
    if (prevNonExcluded.length === 0) return false;

    const lastPrev = prevNonExcluded[prevNonExcluded.length - 1];
    const prevHash = dataRows[rowIdx][lastPrev]?.trim();
    return !!prevHash && cellHash !== prevHash;
  }, [dataRows, numCols, excludedCols]);

  const colHasDiff = useCallback((colIdx: number): boolean => {
    for (let ri = 0; ri < dataRows.length; ri++) {
      if (isDiffCell(ri, colIdx)) return true
    }
    return false
  }, [dataRows, isDiffCell])

  const handleCellClick = useCallback((hash: string, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.stopPropagation();
      if (diffOpen) {
        setDiffOpen(false);
        setCompareA(null);
        setCompareB(null);
      }
      if (compareA === null) {
        setCompareA(hash);
      } else if (compareB === null && hash !== compareA) {
        setCompareB(hash);
        setDiffOpen(true);
      } else {
        setCompareA(hash);
        setCompareB(null);
        setDiffOpen(false);
      }
    } else {
      setModalHash(hash);
    }
  }, [compareA, compareB, diffOpen]);

  const handleDeleteColumn = useCallback((colIdx: number, label: string) => {
    if (window.confirm(`Delete call "${label}" permanently? This cannot be undone.`)) {
      onDeleteColumn?.(colIdx)
    }
  }, [onDeleteColumn])

  const contentExcerpt = useCallback((hash: string): string => {
    const val = hash_map[hash];
    if (!val) return '';
    if (typeof val === 'string') return val.substring(0, 40);
    return JSON.stringify(val).substring(0, 40);
  }, [hash_map]);

  const lastNonEmptyHashInRow = useCallback((rowIdx: number): string | null => {
    for (let c = numCols - 1; c >= 0; c--) {
      const h = dataRows[rowIdx][c]?.trim();
      if (h && hash_map[h]) return h;
    }
    return null;
  }, [dataRows, numCols, hash_map]);

  return (
    <div className="hash-grid-container" ref={gridRef}>
      <div className="hash-grid-wrapper">
        <table className="hash-grid">
          <thead>
            <tr>
              {header.map((label, ci) => {
                const hasDiff = colHasDiff(ci)
                let thCls = 'hash-cell'
                if (excludedCols.has(ci)) thCls += ' excluded'
                if (hasDiff) thCls += ' col-diff'
                else thCls += ' col-match'
                return (
                  <th
                    key={ci}
                    className={thCls}
                    onClick={() => toggleExclude(ci)}
                    title="Click to exclude this call from diff comparison"
                  >
                    {label}
                    <button
                      className="col-delete-btn"
                      onClick={(e) => { e.stopPropagation(); handleDeleteColumn(ci, label) }}
                      title="Delete this call permanently"
                    >
                      ✕
                    </button>
                  </th>
                )
              })}
              <th className="content-cell">Content</th>
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => {
              const lastHash = lastNonEmptyHashInRow(ri);
              return (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    const hash = cell?.trim() || null;
                    let cls = 'hash-cell';
                    if (hash && isDiffCell(ri, ci)) cls += ' diff-cell';
                    if (excludedCols.has(ci)) cls += ' excluded';
                    if (hash && hash === compareA) cls += ' compare-a';
                    if (hash && hash === compareB) cls += ' compare-b';

                    return (
                      <td
                        key={ci}
                        className={cls}
                        onClick={hash ? (e) => handleCellClick(hash, e) : undefined}
                        title={hash ? 'Click to view content | Ctrl+click to compare' : undefined}
                      >
                        {hash || ''}
                      </td>
                    );
                  })}
                  <td className="content-cell">
                    {lastHash ? contentExcerpt(lastHash) : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="hints">
          <span className="hint"><kbd>Ctrl</kbd>+click hash → compare two hashes</span>
          <span className="hint sep">|</span>
          <span className="hint">Click column header → exclude call</span>
        </div>
      </div>

      {/* Modal */}
      {modalHash && (
        <div className="modal-overlay" onClick={() => setModalHash(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-hash">{modalHash}</span>
              <button className="modal-close" onClick={() => setModalHash(null)}>×</button>
            </div>
            <div className="modal-body">
              <ContentView hash={modalHash} hashMap={hash_map} />
            </div>
          </div>
        </div>
      )}

      {/* Diff Panel */}
      {diffOpen && compareA && compareB && (
        <div className="modal-overlay" onClick={() => { setDiffOpen(false); setCompareA(null); setCompareB(null); }}>
          <div className="modal-content wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-hash">Diff: {compareA} vs {compareB}</span>
              <button className="modal-close" onClick={() => { setDiffOpen(false); setCompareA(null); setCompareB(null); }}>×</button>
            </div>
            <div className="modal-body">
              <DiffView hashA={compareA} hashB={compareB} hashMap={hash_map} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContentView({ hash, hashMap }: { hash: string; hashMap: Record<string, string> }) {
  const content = hashMap[hash];
  if (content === undefined) return <div className="content-text">No content found for hash: {hash}</div>;

  const toolHtml = renderToolContent(content);
  if (toolHtml) {
    return <div dangerouslySetInnerHTML={{ __html: toolHtml }} />;
  }

  return <pre className="content-text">{content}</pre>;
}

function DiffView({ hashA, hashB, hashMap }: { hashA: string; hashB: string; hashMap: Record<string, string> }) {
  const contentA = hashMap[hashA] || '';
  const contentB = hashMap[hashB] || '';

  const isToolA = isToolJson(contentA);
  const isToolB = isToolJson(contentB);

  if (isToolA && isToolB) {
    const html = renderToolDiff(contentA, contentB);
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  const diffLines = computeDiff(contentA, contentB);
  return (
    <div className="diff-lines">
      {diffLines.map((line, i) => {
        const lineNum = line.type === 'added' ? `  ${line.lineB}` : `${line.lineA}  `;
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        return (
          <div key={i} className={`diff-line ${line.type}`}>
            <span className="diff-line-number">{lineNum}</span>
            <span className="diff-line-content">{prefix} {line.content}</span>
          </div>
        );
      })}
    </div>
  );
}

function isToolJson(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) && parsed.length > 0 && parsed[0].type === 'function';
  } catch { return false; }
}

function renderToolContent(content: string): string | null {
  if (!isToolJson(content)) return null;
  const tools = JSON.parse(content);
  let html = '<div class="tools-container">';
  for (const tool of tools) {
    html += renderToolCard(tool);
  }
  html += '</div>';
  return html;
}

function renderToolCard(tool: any): string {
  const fn = tool.function || {};
  const name = fn.name || 'unknown';
  const desc = fn.description || '';
  const params = fn.parameters || {};
  const props = params.properties || {};
  const required = new Set(params.required || []);

  let html = '<div class="tool-card">';
  html += `<div class="tool-name">${escapeHtml(name)}</div>`;
  if (desc) html += `<div class="tool-desc">${escapeHtml(desc)}</div>`;
  const propKeys = Object.keys(props);
  if (propKeys.length > 0) {
    html += '<table class="tool-params">';
    html += '<tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>';
    for (const key of propKeys) {
      const p = props[key];
      const isReq = required.has(key) ? 'yes' : 'no';
      html += `<tr><td class="param-name">${escapeHtml(key)}</td><td>${escapeHtml(p.type || 'any')}</td><td class="param-req-${isReq}">${isReq}</td><td class="param-desc">${escapeHtml(p.description || '')}</td></tr>`;
    }
    html += '</table>';
  }
  html += '</div>';
  return html;
}

function renderToolDiff(contentA: string, contentB: string): string {
  const toolsA = JSON.parse(contentA);
  const toolsB = JSON.parse(contentB);
  const mapA = Object.fromEntries(toolsA.map((t: any) => [t.function?.name, t]));
  const mapB = Object.fromEntries(toolsB.map((t: any) => [t.function?.name, t]));
  const allNames = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])].sort();

  let html = '<div class="tools-container">';
  for (const name of allNames) {
    const ta = mapA[name];
    const tb = mapB[name];
    if (ta && !tb) {
      html += `<div class="diff-line removed"><span class="diff-line-content">- ${escapeHtml(name)}</span></div>`;
      html += `<div class="tool-card removed">${renderToolCardContent(ta)}</div>`;
    } else if (!ta && tb) {
      html += `<div class="diff-line added"><span class="diff-line-content">+ ${escapeHtml(name)}</span></div>`;
      html += `<div class="tool-card added">${renderToolCardContent(tb)}</div>`;
    } else {
      const strA = JSON.stringify(ta);
      const strB = JSON.stringify(tb);
      if (strA !== strB) {
        html += `<div class="diff-line changed"><span class="diff-line-content">~ ${escapeHtml(name)}</span></div>`;
        html += `<div class="tool-card removed">${renderToolCardContent(ta)}</div>`;
        html += `<div class="tool-card added">${renderToolCardContent(tb)}</div>`;
      } else {
        html += `<div class="diff-line unchanged"><span class="diff-line-content">  ${escapeHtml(name)}</span></div>`;
      }
    }
  }
  html += '</div>';
  return html;
}

function renderToolCardContent(tool: any): string {
  const fn = tool.function || {};
  const desc = fn.description || '';
  const params = fn.parameters || {};
  const props = params.properties || {};
  const required = new Set(params.required || []);

  let html = `<div class="tool-name">${escapeHtml(fn.name || 'unknown')}</div>`;
  if (desc) html += `<div class="tool-desc">${escapeHtml(desc)}</div>`;
  const propKeys = Object.keys(props);
  if (propKeys.length > 0) {
    html += '<table class="tool-params">';
    html += '<tr><th>Param</th><th>Type</th><th>Req</th><th>Description</th></tr>';
    for (const key of propKeys) {
      const p = props[key];
      const isReq = required.has(key) ? 'yes' : 'no';
      html += `<tr><td class="param-name">${escapeHtml(key)}</td><td>${escapeHtml(p.type || 'any')}</td><td class="param-req-${isReq}">${isReq}</td><td class="param-desc">${escapeHtml(p.description || '')}</td></tr>`;
    }
    html += '</table>';
  }
  html += '</div>';
  return html;
}

function computeDiff(textA: string, textB: string): DiffLine[] {
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');
  const maxLen = Math.max(linesA.length, linesB.length);
  const result: DiffLine[] = [];

  for (let i = 0; i < maxLen; i++) {
    const lineA = linesA[i] || '';
    const lineB = linesB[i] || '';
    if (lineA === lineB) {
      result.push({ type: 'unchanged', lineA: i + 1, lineB: i + 1, content: lineA });
    } else if (lineA && !lineB) {
      result.push({ type: 'removed', lineA: i + 1, lineB: null, content: lineA });
    } else if (!lineA && lineB) {
      result.push({ type: 'added', lineA: null, lineB: i + 1, content: lineB });
    } else {
      result.push({ type: 'removed', lineA: i + 1, lineB: null, content: lineA });
      result.push({ type: 'added', lineA: null, lineB: i + 1, content: lineB });
    }
  }

  return result;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
