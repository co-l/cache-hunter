#!/usr/bin/env tsx
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'cache-hunter.db');

async function diffSystemPrompts() {
  const SQL = await initSqlJs();
  const data = readFileSync(DB_PATH);
  const db = new SQL.Database(data);

  const query = `
    SELECT 
      r.body,
      r.timestamp
    FROM requests r
    WHERE r.path = '/v1/chat/completions'
    ORDER BY r.timestamp
  `;

  const results = db.exec(query);
  const completions = results[0].values.map(row => {
    const body = row[0] as string;
    const parsed = JSON.parse(body);
    return {
      messages: parsed.messages || [],
    };
  });

  const sysPrompt1 = completions[1].messages[0].content;
  const sysPrompt2 = completions[2].messages[0].content;

  console.log('Call 1 system prompt length:', sysPrompt1.length);
  console.log('Call 2 system prompt length:', sysPrompt2.length);
  console.log('Difference:', sysPrompt2.length - sysPrompt1.length);
  console.log('\n=== DIFF ===\n');

  const lines1 = sysPrompt1.split('\n');
  const lines2 = sysPrompt2.split('\n');
  const maxLines = Math.max(lines1.length, lines2.length);

  for (let i = 0; i < maxLines; i++) {
    const line1 = lines1[i] || '';
    const line2 = lines2[i] || '';
    
    if (line1 !== line2) {
      console.log(`Line ${i}:`);
      console.log(`  Call 1: ${line1.substring(0, 100)}`);
      console.log(`  Call 2: ${line2.substring(0, 100)}`);
      console.log();
    }
  }

  db.close();
}

diffSystemPrompts().catch(console.error);
