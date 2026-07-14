import { useState, useCallback, useRef, useEffect } from 'react';
import type { TreeData } from '../hooks/useApi';
import { JsonViewer } from './JsonViewer';
import { JsonDiff } from './JsonDiff';
import './HashGrid.css';

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
                    {ri === 0 ? 'Reasoning Effort' : ri === 1 ? 'Tools' : lastHash ? contentExcerpt(lastHash) : ''}
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

  return <JsonViewer data={content} />;
}

function DiffView({ hashA, hashB, hashMap }: { hashA: string; hashB: string; hashMap: Record<string, string> }) {
  const contentA = hashMap[hashA] || '';
  const contentB = hashMap[hashB] || '';

  return <JsonDiff sourceA={contentA} sourceB={contentB} />;
}
