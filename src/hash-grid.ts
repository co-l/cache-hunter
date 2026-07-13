import { hashContent } from './context-tree.js';

export interface MessageGrid {
  rows: number;
  cols: number;
  cells: (string | null)[][];
}

export interface GridResult {
  grid: MessageGrid;
  hashMap: Record<string, string>;
}

export function buildMessageHashGrid(
  completions: Array<{ messages: Array<{ role: string; content: string }> }>
): GridResult {
  const maxMessages = Math.max(...completions.map(c => c.messages.length), 0);
  const numCompletions = completions.length;
  const hashMap: Record<string, string> = {};
  const cells: (string | null)[][] = [];

  for (let msgIdx = 0; msgIdx < maxMessages; msgIdx++) {
    const row: (string | null)[] = [];
    for (let compIdx = 0; compIdx < numCompletions; compIdx++) {
      const msg = completions[compIdx].messages[msgIdx];
      if (msg) {
        const hash = hashContent(msg.content);
        row.push(hash);
        hashMap[hash] = msg.content;
      } else {
        row.push(null);
      }
    }
    cells.push(row);
  }

  return {
    grid: { rows: maxMessages, cols: numCompletions, cells },
    hashMap,
  };
}

export function computeToolsHashes(
  completions: Array<{ tools?: any[] }>
): (string | null)[] {
  return completions.map(comp => {
    if (comp.tools && comp.tools.length > 0) {
      return hashContent(JSON.stringify(comp.tools));
    }
    return null;
  });
}

export function buildHeaderLabels(completions: Array<{ path: string }>): string[] {
  return completions.map((c, i) => {
    const label = c.path === '/v1/responses' ? 'R' : 'C';
    return `${label}${String(i).padStart(3)}`;
  });
}

export interface TreeData {
  lines: string[][];
  hash_map: Record<string, string>;
  all_completions: any[];
  _grid: MessageGrid;
  _toolsHashes: (string | null)[];
}

export function buildTreeData(
  completions: Array<{
    messages: Array<{ role: string; content: string }>;
    tools?: any[];
    path: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoningEffort?: string;
  }>,
  includeFullCompletions?: boolean
): TreeData {
  const { grid, hashMap } = buildMessageHashGrid(completions);
  const toolsHashes = computeToolsHashes(completions);

  completions.forEach((comp, idx) => {
    const hash = toolsHashes[idx];
    if (hash && comp.tools) {
      hashMap[hash] = JSON.stringify(comp.tools, null, 2);
    }
  });

  const header = buildHeaderLabels(completions);
  const effortRow = completions.map(c => c.reasoningEffort || '');
  const allRows = [effortRow, toolsHashes, ...grid.cells];
  const lines = [header, ...allRows.map(row => row.map(h => h || '    '))];

  return {
    lines,
    hash_map: hashMap,
    all_completions: includeFullCompletions ? completions : [],
    _grid: grid,
    _toolsHashes: toolsHashes,
  };
}
