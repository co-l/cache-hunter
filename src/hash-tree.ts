#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';
import initSqlJs from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hashContent } from './context-tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'cache-hunter.db');
const filterHash = process.argv[2];

export interface MessageGrid {
  rows: number;
  cols: number;
  cells: (string | null)[][];
}

const hash_map = {}

export function buildMessageHashGrid(completions: Array<{ messages: Array<{ role: string; content: string }> }>): MessageGrid {
  const maxMessages = Math.max(...completions.map(c => c.messages.length));
  const numCompletions = completions.length;
  
  const cells: (string | null)[][] = [];
  
  for (let msgIdx = 0; msgIdx < maxMessages; msgIdx++) {
    const row: (string | null)[] = [];
    for (let compIdx = 0; compIdx < numCompletions; compIdx++) {
      const msg = completions[compIdx].messages[msgIdx];
      if (msg) {
        const hash = hashContent(msg.content);
        row.push(hash);
        // @ts-ignore
        hash_map[hash] = msg.content;
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

  const allCompletions = results[0].values.map(row => {
    const body = row[0] as string;
    const parsed = JSON.parse(body);
    return {
      messages: (parsed.messages || []) as Array<{ role: string; content: string }>,
      tools: parsed.tools || [],
    };
  });

  const PARALLEL_PROMPT_KEYWORDS = [
    'Generate a concise, descriptive session name',
    'Write a 2-3 sentence summary of what the user wants to accomplish',
  ];
  
  const filteredCompletions = allCompletions.map((completion, idx) => {
    const filtered = completion.messages.filter(msg => 
      !PARALLEL_PROMPT_KEYWORDS.some(keyword => {
        const matches = msg.content && msg.content.includes(keyword);
        if (matches) {
          console.log(`  [Call ${idx}] Filtering out message with keyword: "${keyword.substring(0, 30)}..."`);
        }
        return matches;
      })
    );
    return {
      messages: filtered,
      tools: completion.tools,
    };
  });
  
  let completions = filteredCompletions.filter(completion => completion.messages.length > 0);

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
  const maxMessages = Math.max(...completions.map(c => c.messages.length));
  
  console.log(`Analyzing ${numCompletions} API calls with max ${maxMessages + 1} items each (tools + messages)...\n`);

  const toolsHashes = completions.map(comp => {
    if (comp.tools && comp.tools.length > 0) {
      const toolsStr = JSON.stringify(comp.tools);
      return hashContent(toolsStr);
    }
    return null;
  });

  const grid = buildMessageHashGrid(completions);

  const allRows = [toolsHashes, ...grid.cells];

  console.log('HASH GRID (rows=tools+messages, cols=API calls):');
  console.log('-'.repeat(80));
  console.log();

  const header = completions.map((_, i) => `${String(i).padStart(4)}`)
  console.log(header.join(' '));
  console.log('-'.repeat(header.length));


  const lines = [
    header
  ]


  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {

    const raw_cells = allRows[rowIdx].map((hash) => hash ? hash : '    ')

    const rowCells = allRows[rowIdx].map((hash, colIdx) => {
      if (!hash) return '    ';
      const prevHashes = allRows[rowIdx].slice(0, colIdx).filter(h => h !== null);
      if (prevHashes.length > 0 && prevHashes[prevHashes.length - 1] !== hash) {
        return `\x1b[31m${hash}\x1b[0m`;
      }
      return hash;
    })

    let preview = '';
    let message = ''
    if (rowIdx === 0) {
      message = preview = '(tools)';
    } else {
      const msgIdx = rowIdx - 1;
      const firstCompletionWithMessage = completions.find(comp => comp.messages[msgIdx]);
      if (firstCompletionWithMessage) {
        message = firstCompletionWithMessage.messages[msgIdx].content
        preview = message
          .replace(/\u001b\[[0-9;]*m/g, '')
          .substring(0, 40)
          .replace(/\n/g, '\\n');
      }
    }

    lines.push(raw_cells)
    
    console.log(`${rowCells.join(' ')} | ${preview}`);
  }
  
  console.log();
  console.log('CONTEXT VALIDATION:');
  console.log('-'.repeat(80));
  
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
      const toolNames = completions[indices[0]].tools.map((t: any) => t.name || t.function?.name);
      console.log(`    Tools: ${toolNames.join(', ')}`);
    }
  } else {
    const callsWithTools = toolsHashes.map((h, i) => h ? i : -1).filter(i => i !== -1);
    const callsWithoutTools = toolsHashes.map((h, i) => h === null ? i : -1).filter(i => i !== -1);
    
    if (callsWithoutTools.length > 0) {
      console.log(`\x1b[31m✗ Tools present in calls [${callsWithTools.join(', ')}] but MISSING in calls [${callsWithoutTools.join(', ')}]\x1b[0m`);
    } else {
      console.log(`\x1b[32m✓ Tools consistent across all calls\x1b[0m`);
    }
  }
  
  let allValid = true;
  for (let msgIdx = 0; msgIdx < maxMessages; msgIdx++) {
    const hashes = grid.cells[msgIdx].filter(h => h !== null) as string[];
    if (hashes.length === 0) continue;
    
    const firstHash = hashes[0];
    const isConsistent = hashes.every(h => h === firstHash);
    
    if (!isConsistent) {
      allValid = false;
      console.log(`\x1b[31m✗ Row ${msgIdx}: HASH MISMATCH - content changed across calls!\x1b[0m`);
      
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
      
      const versionEntries = [...uniqueVersions.entries()];
      if (versionEntries.length === 2) {
        const [hash1, versions1] = versionEntries[0];
        const [hash2, versions2] = versionEntries[1];
        if (!versions1[0] || !versions2[0]) return;
        const content1 = versions1[0]?.content;
        const content2 = versions2[0]?.content;
        
        if (!content1 || !content2) continue;
        
        console.log(`\n  Version 1 [${hash1}] (${content1?.length ?? 0} chars):`);
        console.log(`  Version 2 [${hash2}] (${content2.length} chars):`);
        console.log('\n  Line-by-line diff:');
        
        const lines1 = content1.split('\n');
        const lines2 = content2.split('\n');
        const maxLines = Math.max(lines1.length, lines2.length);
        
        let diffCount = 0;
        for (let i = 0; i < maxLines && diffCount < 10; i++) {
          const line1 = lines1[i] || '';
          const line2 = lines2[i] || '';
          
          if (line1 !== line2) {
            diffCount++;
            console.log(`    Line ${i}:`);
            console.log(`      V1: ${line1.substring(0, 80)}`);
            console.log(`      V2: ${line2.substring(0, 80)}`);
          }
        }
        
        if (diffCount >= 10) {
          console.log('    ... (showing first 10 differences)');
        }
      } else {
        for (const [hash, versions] of uniqueVersions) {
          let content = typeof versions[0].content === 'string' 
            ? versions[0].content.replace(/\n/g, '\\n')
            : JSON.stringify(versions[0].content);
          
          if (content.length > 200) {
            content = content.substring(0, 200) + '...';
          }
          
          console.log(`  [${hash}] ${content}`);
        }
      }
    }
  }
  
  if (allValid) {
    console.log('\x1b[32m✓ All messages have consistent hashes across API calls!\x1b[0m');
  }


  console.log("html-tree/tree-data.json written with all data")
  writeFileSync("html-tree/tree-data.json", JSON.stringify({
    lines,
    hash_map,
    all_completions: allCompletions
  }))

  db.close();
}

showHashTree().catch(console.error);
