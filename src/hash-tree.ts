#!/usr/bin/env tsx
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hashContent } from './context-tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'cache-hunter.db');

export interface MessageGrid {
  rows: number;
  cols: number;
  cells: (string | null)[][];
}

export function buildMessageHashGrid(completions: Array<{ messages: Array<{ role: string; content: string }> }>): MessageGrid {
  const maxMessages = Math.max(...completions.map(c => c.messages.length));
  const numCompletions = completions.length;
  
  const cells: (string | null)[][] = [];
  
  for (let msgIdx = 0; msgIdx < maxMessages; msgIdx++) {
    const row: (string | null)[] = [];
    for (let compIdx = 0; compIdx < numCompletions; compIdx++) {
      const msg = completions[compIdx].messages[msgIdx];
      if (msg) {
        row.push(hashContent(msg.content));
      } else {
        row.push(null);
      }
    }
    cells.push(row);
  }
  
  return {
    rows: maxMessages,
    cols: numCompletions,
    cells,
  };
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
      resp.prompt_tokens,
      r.timestamp
    FROM requests r
    JOIN responses resp ON r.id = resp.request_id
    WHERE r.path = '/v1/chat/completions'
    ORDER BY r.timestamp
  `;

  const results = db.exec(query);
  if (results.length === 0 || results[0].values.length === 0) {
    console.log('No conversation data found');
    db.close();
    return;
  }

  // Extract all completions in order
  const allCompletions = results[0].values.map(row => {
    const body = row[0] as string;
    const parsed = JSON.parse(body);
    return parsed.messages || [];
  });

  // Filter out parallel prompts (session title, summary generation)
  const PARALLEL_PROMPT_KEYWORDS = [
    'Generate a concise, descriptive session name',
    'Write a 2-3 sentence summary of what the user wants to accomplish',
  ];
  
  // First filter messages within each completion
  const filteredCompletions = allCompletions.map(messages => 
    messages.filter((msg: { role: string; content: string }) => 
      !PARALLEL_PROMPT_KEYWORDS.some(keyword => msg.content.includes(keyword))
    )
  );
  
  // Then filter out completions that are now empty (only had parallel prompts)
  const completions = filteredCompletions.filter(messages => messages.length > 0);

  const numCompletions = completions.length;
  const maxMessages = Math.max(...completions.map(c => c.length));
  
  console.log(`Analyzing ${numCompletions} API calls with max ${maxMessages} messages each...\n`);

  // Build hash grid
  const grid = buildMessageHashGrid(completions.map(messages => ({ messages })));

  console.log('HASH GRID (rows=messages, cols=API calls):');
  console.log('-'.repeat(80));
  console.log();

  // Header row
  const header = completions.map((_, i) => `${String(i).padStart(4)}`).join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  
  // Data rows
  for (let msgIdx = 0; msgIdx < maxMessages; msgIdx++) {
    const rowCells = grid.cells[msgIdx].map((hash, colIdx) => {
      if (!hash) return '    ';
      // Check if this hash differs from the last non-null hash in this row
      const prevHashes = grid.cells[msgIdx].slice(0, colIdx).filter(h => h !== null);
      if (prevHashes.length > 0 && prevHashes[prevHashes.length - 1] !== hash) {
        return `\x1b[31m${hash}\x1b[0m`; // Red for mismatch
      }
      return hash;
    }).join(' ');
    
    // Get preview from first message in this row
    const firstCompletionWithMessage = completions.find(comp => comp[msgIdx]);
    let preview = firstCompletionWithMessage 
      ? firstCompletionWithMessage[msgIdx].content.substring(0, 40).replace(/\n/g, '\\n')
      : '';
    
    // Highlight based on message role
    const messageRole = firstCompletionWithMessage ? firstCompletionWithMessage[msgIdx].role : '';
    if (messageRole === 'user') {
      preview = `\x1b[32m${preview}\x1b[0m`; // Green for user messages
    } else if (messageRole === 'system') {
      preview = `\x1b[34m${preview}\x1b[0m`; // Blue for system messages
    }
    
    console.log(`${rowCells} | ${preview}`);
  }
  
  console.log();
  console.log('CONTEXT VALIDATION:');
  console.log('-'.repeat(80));
  
  // Validate: each message should have same hash across all calls where it appears
  let allValid = true;
  for (let msgIdx = 0; msgIdx < maxMessages; msgIdx++) {
    const hashes = grid.cells[msgIdx].filter(h => h !== null) as string[];
    if (hashes.length === 0) continue;
    
    const firstHash = hashes[0];
    const isConsistent = hashes.every(h => h === firstHash);
    
    if (!isConsistent) {
      allValid = false;
      console.log(`\x1b[31m✗ Row ${msgIdx}: HASH MISMATCH - content changed across calls!\x1b[0m`);
      
      // Group by unique hash and show only different versions
      const uniqueVersions = new Map<string, { callIdx: number; content: string }[]>();
      
      completions.forEach((comp, idx) => {
        const message = comp[msgIdx];
        if (message) {
          const hash = grid.cells[msgIdx][idx]!;
          if (!uniqueVersions.has(hash)) {
            uniqueVersions.set(hash, []);
          }
          uniqueVersions.get(hash)!.push({
            callIdx: idx,
            content: message.content,
          });
        }
      });
      
      // Show each unique version
      for (const [hash, versions] of uniqueVersions) {
        const content = versions[0].content.replace(/\n/g, '\\n');
        console.log(`  [${hash}] ${content}`);
      }
    }
  }
  
  if (allValid) {
    console.log('\x1b[32m✓ All messages have consistent hashes across API calls!\x1b[0m');
  }

  db.close();
}

showHashTree().catch(console.error);
