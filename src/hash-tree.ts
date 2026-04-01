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
    return {
      messages: (parsed.messages || []) as Array<{ role: string; content: string }>,
      tools: parsed.tools || [],
    };
  });

  // Filter out parallel prompts (session title, summary generation)
  const PARALLEL_PROMPT_KEYWORDS = [
    'Generate a concise, descriptive session name',
    'Write a 2-3 sentence summary of what the user wants to accomplish',
  ];
  
  // First filter messages within each completion
  const filteredCompletions = allCompletions.map(completion => ({
    messages: completion.messages.filter(msg => 
      !PARALLEL_PROMPT_KEYWORDS.some(keyword => msg.content.includes(keyword))
    ),
    tools: completion.tools,
  }));
  
  // Then filter out completions that are now empty (only had parallel prompts)
  const completions = filteredCompletions.filter(completion => completion.messages.length > 0);

  const numCompletions = completions.length;
  const maxMessages = Math.max(...completions.map(c => c.messages.length));
  
  console.log(`Analyzing ${numCompletions} API calls with max ${maxMessages + 1} items each (tools + messages)...\n`);

  // Build hash grid for tools + messages
  const toolsHashes = completions.map(comp => {
    if (comp.tools && comp.tools.length > 0) {
      const toolsStr = JSON.stringify(comp.tools);
      return hashContent(toolsStr);
    }
    return null;
  });

  // Build hash grid for messages
  const grid = buildMessageHashGrid(completions);

  // Combine tools (row 0) + messages (rows 1..n)
  const allRows = [toolsHashes, ...grid.cells];

  console.log('HASH GRID (rows=tools+messages, cols=API calls):');
  console.log('-'.repeat(80));
  console.log();

  // Header row
  const header = completions.map((_, i) => `${String(i).padStart(4)}`).join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  
  // Data rows (tools + messages)
  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const rowCells = allRows[rowIdx].map((hash, colIdx) => {
      if (!hash) return '    ';
      // Check if this hash differs from the last non-null hash in this row
      const prevHashes = allRows[rowIdx].slice(0, colIdx).filter(h => h !== null);
      if (prevHashes.length > 0 && prevHashes[prevHashes.length - 1] !== hash) {
        return `\x1b[31m${hash}\x1b[0m`; // Red for mismatch
      }
      return hash;
    }).join(' ');
    
    // Get preview
    let preview = '';
    if (rowIdx === 0) {
      preview = '(tools)';
    } else {
      const msgIdx = rowIdx - 1;
      const firstCompletionWithMessage = completions.find(comp => comp.messages[msgIdx]);
      if (firstCompletionWithMessage) {
        preview = firstCompletionWithMessage.messages[msgIdx].content.substring(0, 40).replace(/\n/g, '\\n');
        
        // Highlight based on message role
        const messageRole = firstCompletionWithMessage.messages[msgIdx].role;
        if (messageRole === 'user') {
          preview = `\x1b[32m${preview}\x1b[0m`; // Green for user messages
        } else if (messageRole === 'system') {
          preview = `\x1b[34m${preview}\x1b[0m`; // Blue for system messages
        }
      }
    }
    
    console.log(`${rowCells} | ${preview}`);
  }
  
  console.log();
  console.log('CONTEXT VALIDATION:');
  console.log('-'.repeat(80));
  
  // Validate tools consistency
  const uniqueToolsHashes = [...new Set(toolsHashes.filter(h => h !== null))];
  if (uniqueToolsHashes.length > 1) {
    console.log(`\x1b[31m✗ TOOLS: Hash changed across calls!\x1b[0m`);
    const toolsVersions = new Map<string, number[]>();
    toolsHashes.forEach((hash, idx) => {
      if (hash) {
        if (!toolsVersions.has(hash)) {
          toolsVersions.set(hash, []);
        }
        toolsVersions.get(hash)!.push(idx);
      }
    });
    for (const [hash, indices] of toolsVersions) {
      console.log(`  Calls ${indices.join(', ')}: [${hash}]`);
    }
  } else {
    console.log(`\x1b[32m✓ Tools consistent across all calls\x1b[0m`);
  }
  
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
        const message = comp.messages[msgIdx];
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
