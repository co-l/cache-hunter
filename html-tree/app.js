let hashMap = {};
let excludedCols = new Set();
let compareA = null;
let compareB = null;

function isToolJson(str) {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) && parsed.length > 0 && parsed[0].type === 'function';
  } catch { return false; }
}

function renderToolCard(tool, idx) {
  const fn = tool.function || {};
  const name = fn.name || 'unknown';
  const desc = fn.description || '';
  const params = fn.parameters || {};
  const props = params.properties || {};
  const required = new Set(params.required || []);

  let html = `<div class="tool-card">`;
  html += `<div class="tool-name">${escapeHtml(name)}</div>`;
  if (desc) {
    html += `<div class="tool-desc">${escapeHtml(desc)}</div>`;
  }
  const propKeys = Object.keys(props);
  if (propKeys.length > 0) {
    html += `<table class="tool-params">`;
    html += `<tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr>`;
    for (const key of propKeys) {
      const p = props[key];
      const isReq = required.has(key) ? 'yes' : 'no';
      html += `<tr><td class="param-name">${escapeHtml(key)}</td><td>${escapeHtml(p.type || 'any')}</td><td class="param-req-${isReq}">${isReq}</td><td class="param-desc">${escapeHtml(p.description || '')}</td></tr>`;
    }
    html += `</table>`;
  }
  html += `</div>`;
  return html;
}

function renderToolContent(content) {
  if (!isToolJson(content)) return null;
  const tools = JSON.parse(content);
  let html = `<div class="tools-container">`;
  for (let i = 0; i < tools.length; i++) {
    html += renderToolCard(tools[i], i);
  }
  html += `</div>`;
  return html;
}

function showModal(hash) {
  const content = hashMap[hash];
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  const hashSpan = document.getElementById('modal-hash');

  if (content === undefined) {
    body.textContent = 'No content found for hash: ' + hash;
  } else if (typeof content === 'string') {
    const formatted = renderToolContent(content);
    if (formatted) {
      body.innerHTML = formatted;
    } else {
      body.textContent = content;
    }
  } else {
    body.textContent = JSON.stringify(content, null, 2);
  }

  hashSpan.textContent = hash;
  modal.classList.add('open');
}

function hideModal() {
  document.getElementById('modal').classList.remove('open');
}

function toggleExclude(colIdx) {
  if (excludedCols.has(colIdx)) {
    excludedCols.delete(colIdx);
  } else {
    excludedCols.add(colIdx);
  }
  renderTable();
}

function handleCellClick(hash, event) {
  if (event.ctrlKey || event.metaKey) {
    selectForCompare(hash, event);
  } else {
    showModal(hash);
  }
}

function selectForCompare(hash, event) {
  event.stopPropagation();
  const diffOpen = document.getElementById('diff-panel').classList.contains('open');
  if (diffOpen) {
    hideDiff();
  }
  if (compareA === null) {
    compareA = hash;
    renderTable();
  } else if (compareB === null && hash !== compareA) {
    compareB = hash;
    showDiff(compareA, compareB);
  } else {
    compareA = hash;
    compareB = null;
    renderTable();
  }
}

function hideDiff() {
  document.getElementById('diff-panel').classList.remove('open');
  compareA = null;
  compareB = null;
  renderTable();
}

function computeDiff(textA, textB) {
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');
  const maxLen = Math.max(linesA.length, linesB.length);
  const result = [];

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

function showDiff(hashA, hashB) {
  const contentA = hashMap[hashA] || '';
  const contentB = hashMap[hashB] || '';

  const panel = document.getElementById('diff-panel');
  const title = document.getElementById('diff-title');
  const body = document.getElementById('diff-body');

  title.textContent = `Diff: ${hashA} vs ${hashB}`;

  let html = '';
  if (isToolJson(contentA) && isToolJson(contentB)) {
    html = renderToolDiff(contentA, contentB);
  } else {
    const diffLines = computeDiff(contentA, contentB);
    for (const line of diffLines) {
      const lineNum = line.type === 'added' ? `  ${line.lineB}` : `${line.lineA}  `;
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      html += `<div class="diff-line ${line.type}"><span class="diff-line-number">${lineNum}</span><span class="diff-line-content">${escapeHtml(prefix + ' ' + line.content)}</span></div>`;
    }
  }
  body.innerHTML = html;
  panel.classList.add('open');
}

function renderToolDiff(contentA, contentB) {
  const toolsA = JSON.parse(contentA);
  const toolsB = JSON.parse(contentB);
  const mapA = Object.fromEntries(toolsA.map(t => [t.function?.name, t]));
  const mapB = Object.fromEntries(toolsB.map(t => [t.function?.name, t]));
  const allNames = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])].sort();

  let html = `<div class="tools-container">`;
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
  html += `</div>`;
  return html;
}

function renderToolCardContent(tool) {
  const fn = tool.function || {};
  const desc = fn.description || '';
  const params = fn.parameters || {};
  const props = params.properties || {};
  const required = new Set(params.required || []);

  let html = `<div class="tool-name">${escapeHtml(fn.name || 'unknown')}</div>`;
  if (desc) html += `<div class="tool-desc">${escapeHtml(desc)}</div>`;
  const propKeys = Object.keys(props);
  if (propKeys.length > 0) {
    html += `<table class="tool-params">`;
    html += `<tr><th>Param</th><th>Type</th><th>Req</th><th>Description</th></tr>`;
    for (const key of propKeys) {
      const p = props[key];
      const isReq = required.has(key) ? 'yes' : 'no';
      html += `<tr><td class="param-name">${escapeHtml(key)}</td><td>${escapeHtml(p.type || 'any')}</td><td class="param-req-${isReq}">${isReq}</td><td class="param-desc">${escapeHtml(p.description || '')}</td></tr>`;
    }
    html += `</table>`;
  }
  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isDiffCell(rowIdx, colIdx, cells) {
  const cellHash = cells[rowIdx][colIdx];
  if (!cellHash || cellHash.trim() === '') return false;

  const nonExcluded = [];
  for (let c = 0; c < cells[rowIdx].length; c++) {
    if (!excludedCols.has(c)) {
      nonExcluded.push(c);
    }
  }

  const prevNonExcluded = nonExcluded.filter(c => c < colIdx);
  if (prevNonExcluded.length === 0) return false;

  const lastPrev = prevNonExcluded[prevNonExcluded.length - 1];
  const prevHash = cells[rowIdx][lastPrev];
  return prevHash && prevHash.trim() !== '' && cellHash !== prevHash;
}

function renderTable() {
  const data = window._treeData;
  if (!data) return;

  const lines = data.lines;
  const numCols = lines[0].length;
  const dataRows = lines.slice(1);

  let html = '<table>';
  html += '<thead><tr>';
  for (let c = 0; c < numCols; c++) {
    const excluded = excludedCols.has(c) ? ' excluded' : '';
    html += `<th class="hash-cell${excluded}" onclick="toggleExclude(${c})" title="Click to exclude this call from diff comparison">${lines[0][c]}</th>`;
  }
  html += '<th class="content-cell">Content</th>';
  html += '</tr></thead>';

  html += '<tbody>';
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    html += '<tr>';

    for (let c = 0; c < numCols; c++) {
      const cellHash = row[c] && row[c].trim() ? row[c].trim() : null;
      let cellClass = 'hash-cell';
      let cellText = cellHash || '';

      if (cellHash && isDiffCell(r, c, dataRows)) {
        cellClass += ' diff-cell';
      }

      if (excludedCols.has(c)) {
        cellClass += ' excluded';
      }

      const isSelectedA = cellHash && cellHash === compareA;
      const isSelectedB = cellHash && cellHash === compareB;
      if (isSelectedA || isSelectedB) {
        cellClass += ' compare-selected';
      }

      let clickAttr = '';
      if (cellHash) {
        clickAttr = ` onclick="handleCellClick('${cellHash}', event)" title="Click to view content | Ctrl+click to compare"`;
      }

      html += `<td class="${cellClass}"${clickAttr}>${cellText}</td>`;
    }

    const contentHash = [...row].reverse().find(h => h && h.trim() && hashMap[h.trim()]);
    let contentText = '';
    if (contentHash) {
      const val = hashMap[contentHash.trim()];
      contentText = typeof val === 'string' ? val.substring(0, 40) : '[image data]';
    }
    html += `<td class="content-cell">${escapeHtml(contentText)}</td>`;

    html += '</tr>';
  }
  html += '</tbody></table>';

  html += '<div id="hints">';
  html += '<span class="hint"><kbd>Ctrl</kbd>+click hash → compare two hashes</span>';
  html += '<span class="hint sep">|</span>';
  html += '<span class="hint">Click column header → exclude call</span>';
  html += '</div>';

  document.getElementById('grid-wrapper').innerHTML = html;
}

function getFilter() {
  const params = new URLSearchParams(window.location.search);
  const tools = params.get('tools');
  return { tools };
}

function applyColumnFilter(lines, filter) {
  if (!filter.tools) return lines;

  const toolsRow = lines[1];
  if (!toolsRow) return lines;

  const keepIndices = [];
  for (let c = 0; c < toolsRow.length; c++) {
    if (toolsRow[c] && toolsRow[c].trim() === filter.tools) {
      keepIndices.push(c);
    }
  }

  if (keepIndices.length === 0) return lines;

  return lines.map(row => keepIndices.map(i => row[i]));
}

async function initGrid() {
  try {
    const response = await fetch('tree-data.json');
    const data = await response.json();

    let lines = data.lines;
    hashMap = data.hash_map || {};

    if (!lines || lines.length === 0) {
      document.getElementById('loading').textContent = 'No data found';
      return;
    }

    const filter = getFilter();
    if (filter.tools) {
      const before = lines[0].length;
      lines = applyColumnFilter(lines, filter);
      const after = lines[0].length;
      document.getElementById('status-bar').textContent = `Filter: tools=${filter.tools}  (${before} → ${after} columns)`;
    }

    data.lines = lines;
    window._treeData = data;
    renderTable();
    document.getElementById('status-bar').textContent = 'Click hash to view content | Ctrl+click to compare two hashes | Click column header to exclude call';
  } catch (error) {
    document.getElementById('loading').textContent = 'Error loading data: ' + error.message;
    console.error(error);
  }
}

function init() {
  const modal = document.getElementById('modal');
  const closeBtn = document.getElementById('modal-close');

  closeBtn.addEventListener('click', hideModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.getElementById('diff-panel').classList.contains('open')) {
        hideDiff();
      } else {
        hideModal();
      }
    }
  });

  const diffPanel = document.getElementById('diff-panel');
  const diffClose = document.getElementById('diff-close');
  diffClose.addEventListener('click', hideDiff);
  diffPanel.addEventListener('click', (e) => {
    if (e.target === diffPanel) hideDiff();
  });

  initGrid();
}

init();
