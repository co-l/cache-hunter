#!/usr/bin/env tsx
import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'cache-hunter.db');

async function compareSystemPrompts() {
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
  if (results.length === 0) {
    console.log('No data found');
    db.close();
    return;
  }

  const completions = results[0].values.map(row => {
    const body = row[0] as string;
    const timestamp = row[1] as string;
    const parsed = JSON.parse(body);
    return {
      timestamp,
      messages: parsed.messages || [],
      tools: parsed.tools || [],
    };
  });

  console.log('='.repeat(80));
  console.log(`Comparing ${completions.length} API calls\n`);

  // Extract system prompts
  const systemPrompts = completions.map((comp, idx) => {
    const sysMsg = comp.messages.find((m: any) => m.role === 'system');
    return {
      idx,
      timestamp: comp.timestamp,
      content: sysMsg?.content || null,
      hasTools: comp.tools && comp.tools.length > 0,
    };
  });

  // Compare each call with the first one
  const basePrompt = systemPrompts[0].content;
  
  for (let i = 1; i < systemPrompts.length; i++) {
    const current = systemPrompts[i];
    const base = systemPrompts[0];
    
    console.log(`\n--- Call ${i} vs Call 0 ---`);
    console.log(`Timestamp: ${current.timestamp}`);
    console.log(`Has tools: ${current.hasTools}`);
    
    if (!basePrompt && !current.content) {
      console.log('Both have no system prompt');
    } else if (!basePrompt && current.content) {
      console.log('Call 0: NO SYSTEM PROMPT');
      console.log(`Call ${i}: HAS SYSTEM PROMPT (${current.content.length} chars)`);
      console.log('\nSystem prompt preview:');
      console.log(current.content.substring(0, 300) + '...');
    } else if (basePrompt && !current.content) {
      console.log(`Call 0: HAS SYSTEM PROMPT (${basePrompt.length} chars)`);
      console.log('Call 1: NO SYSTEM PROMPT');
    } else if (basePrompt === current.content) {
      console.log('System prompts are IDENTICAL');
    } else {
      console.log(`Call 0: ${basePrompt.length} chars`);
      console.log(`Call ${i}: ${current.content?.length} chars`);
      console.log('\nDIFFERENCES:');
      
      // Find first difference
      const baseLines = basePrompt.split('\n');
      const currLines = current.content!.split('\n');
      
      for (let line = 0; line < Math.max(baseLines.length, currLines.length); line++) {
        const baseLine = baseLines[line];
        const currLine = currLines[line];
        
        if (baseLine !== currLine) {
          console.log(`  Line ${line}:`);
          console.log(`    Call 0: ${baseLine?.substring(0, 80)}`);
          console.log(`    Call ${i}: ${currLine?.substring(0, 80)}`);
          break;
        }
      }
    }
  }

  db.close();
}

compareSystemPrompts().catch(console.error);
