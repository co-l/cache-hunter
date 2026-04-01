#!/usr/bin/env tsx
import { readFileSync } from 'fs';
import initSqlJs, { Database } from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildContextTree, hashContent } from './context-tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'cache-hunter.db');

async function visualizeContext() {
  const SQL = await initSqlJs();
  
  const data = readFileSync(DB_PATH);
  const db = new SQL.Database(data);

  console.log('Context Coherence Analysis\n');
  console.log('='.repeat(80));

  const query = `
    SELECT 
      r.id,
      datetime(r.timestamp/1000, 'unixepoch', 'localtime') as timestamp,
      r.body,
      resp.prompt_tokens,
      resp.duration_ms
    FROM requests r
    JOIN responses resp ON r.id = resp.request_id
    WHERE r.path = '/v1/chat/completions'
    ORDER BY r.timestamp
    LIMIT 1
  `;

  const results = db.exec(query);
  if (results.length === 0 || results[0].values.length === 0) {
    console.log('No conversation data found');
    db.close();
    return;
  }

  const body = results[0].values[0][2] as string;
  const parsed = JSON.parse(body);
  const messages = parsed.messages || [];

  console.log(`Conversation: ${messages.length} turns\n`);
  console.log('Context Hash Tree:');
  console.log('-'.repeat(80));

  const tree = buildContextTree(messages);
  
  for (const node of tree) {
    const prefix = ' '.repeat((node.turn - 1) * 4);
    console.log(`${prefix}Turn ${node.turn} (${node.role}):`);
    console.log(`${prefix}  Content: "${node.content.substring(0, 50)}${node.content.length > 50 ? '...' : ''}"`);
    console.log(`${prefix}  Hash: ${node.messageHash}`);
    console.log(`${prefix}  Context: ${node.contextHash}`);
    console.log();
  }

  console.log('-'.repeat(80));
  console.log('\nVisual Hash Chain:');
  console.log('-'.repeat(80));

  const maxLength = Math.max(...messages.map((m: any) => m.content.length));
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const hash = hashContent(msg.content);
    const contentPreview = msg.content.substring(0, Math.min(60, maxLength));
    console.log(`T${i + 1}: [${hash}] ${contentPreview}${msg.content.length > 60 ? '...' : ''}`);
  }

  console.log('\n\nCumulative Context Chain:');
  console.log('-'.repeat(80));
  
  let cumulative = '';
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgHash = hashContent(msg.content);
    cumulative += msgHash;
    const contextHash = hashContent(cumulative);
    
    console.log(`Turn ${i + 1}: ${cumulative.split('').join(' ')} = ${contextHash}`);
  }

  db.close();
}

visualizeContext().catch(console.error);
