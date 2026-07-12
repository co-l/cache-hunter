#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';
import initSqlJs from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hashContent } from './context-tree.js';
import { parseRequestBody, extractTokensFromResponse } from './parse-api.js';
import { buildTreeData } from './hash-grid.js';
import { printValidationReport } from './context-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', 'data', 'cache-hunter.db');
const DB_PATH = process.argv[2] || DEFAULT_DB_PATH;
const filterHash = process.argv[3];

const PARALLEL_PROMPT_KEYWORDS = [
  'Generate a concise, descriptive session name',
  'Write a 2-3 sentence summary of what the user wants to accomplish',
  'You are a title generator.',
  'Generate a title for this conversation',
];

function filterParallelPrompts(
  completions: Array<{ messages: Array<{ role: string; content: string }>; tools?: any[]; path: string }>
): Array<{ messages: Array<{ role: string; content: string }>; tools?: any[]; path: string }> {
  return completions.map((completion, idx) => {
    const filtered = completion.messages.filter(msg =>
      !PARALLEL_PROMPT_KEYWORDS.some(keyword => {
        const matches = msg.content && msg.content.includes(keyword);
        if (matches) {
          console.log(`  [Call ${idx}] Filtering out message with keyword: "${keyword.substring(0, 30)}..."`);
        }
        return matches;
      })
    );
    return { messages: filtered, tools: completion.tools, path: completion.path };
  }).filter(completion => completion.messages.length > 0);
}

async function showHashTree() {
  const SQL = await initSqlJs();
  const data = readFileSync(DB_PATH);
  const db = new SQL.Database(data);

  console.log('Context Coherence Verification\n');
  console.log('='.repeat(80));

  const query = `
    SELECT
      r.body,
      resp.body,
      resp.prompt_tokens,
      r.path,
      r.timestamp
    FROM requests r
    JOIN responses resp ON r.id = resp.request_id
    WHERE r.path IN ('/v1/chat/completions', '/v1/responses')
    ORDER BY r.timestamp
  `;

  const results = db.exec(query);
  if (results.length === 0 || results[0].values.length === 0) {
    console.log('No conversation data found');
    db.close();
    return;
  }

  const allCompletions = results[0].values.map(row => {
    const reqBody = row[0] as string;
    const resBody = row[1] as string;
    const dbPromptTokens = row[2] as number | null;
    const path = row[3] as string;
    const parsed = parseRequestBody(reqBody, path);

    let tokens: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {};
    if (dbPromptTokens == null) {
      tokens = extractTokensFromResponse(resBody, path);
    }

    return {
      messages: parsed.messages,
      tools: parsed.tools,
      path,
      prompt_tokens: tokens.prompt_tokens ?? dbPromptTokens ?? undefined,
      completion_tokens: tokens.completion_tokens,
      total_tokens: tokens.total_tokens,
    };
  });

  let completions = filterParallelPrompts(allCompletions);

  if (filterHash) {
    const originalCount = completions.length;
    completions = completions.filter(comp => {
      const firstMsg = comp.messages[0];
      if (!firstMsg) return false;
      const firstMsgHash = hashContent(firstMsg.content);
      return firstMsgHash === filterHash;
    });
    console.log(`Filtered from ${originalCount} to ${completions.length} calls matching hash ${filterHash}\n`);
  }

  const numCompletions = completions.length;
  const maxMessages = Math.max(...completions.map(c => c.messages.length), 0);

  const endpointCounts = completions.reduce((acc, c) => {
    acc[c.path] = (acc[c.path] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const endpointSummary = Object.entries(endpointCounts)
    .map(([p, n]) => `${n}x ${p}`)
    .join(', ');

  console.log(`Analyzing ${numCompletions} API calls (${endpointSummary}) with max ${maxMessages + 1} items each (tools + messages)...\n`);

  const treeData = buildTreeData(completions, true);
  const header = treeData.lines[0];
  const grid = treeData._grid;
  const toolsHashes = treeData._toolsHashes;
  const allRows = [toolsHashes, ...grid.cells];

  console.log('HASH GRID (rows=tools+messages, cols=API calls):');
  console.log('-'.repeat(80));
  console.log();
  console.log(header.join(' '));
  console.log('-'.repeat(header.length));

  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const rowCells = allRows[rowIdx].map((hash, colIdx) => {
      if (!hash) return '    ';
      const prevHashes = allRows[rowIdx].slice(0, colIdx).filter(h => h !== null);
      if (prevHashes.length > 0 && prevHashes[prevHashes.length - 1] !== hash) {
        return `\x1b[31m${hash}\x1b[0m`;
      }
      return hash;
    });

    let preview = '';
    if (rowIdx === 0) {
      preview = '(tools)';
    } else {
      const msgIdx = rowIdx - 1;
      const firstCompletionWithMessage = completions.find(comp => comp.messages[msgIdx]);
      if (firstCompletionWithMessage) {
        const content = firstCompletionWithMessage.messages[msgIdx].content;
        const message = typeof content === 'string' ? content : JSON.stringify(content);
        preview = message
          .replace(/\u001b\[[0-9;]*m/g, '')
          .substring(0, 40)
          .replace(/\n/g, '\\n');
      }
    }

    console.log(`${rowCells.join(' ')} | ${preview}`);
  }

  printValidationReport(grid, completions, toolsHashes);

  console.log("html-tree/tree-data.json written with all data");
  writeFileSync("html-tree/tree-data.json", JSON.stringify(treeData));

  db.close();
}

showHashTree().catch(console.error);
