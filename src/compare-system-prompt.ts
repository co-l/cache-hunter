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

  // Compare first two calls
  const call0 = systemPrompts[0];
  const call1 = systemPrompts[1];

  console.log('CALL 0:');
  console.log(`  Index: ${call0.idx}`);
  console.log(`  Timestamp: ${call0.timestamp}`);
  console.log(`  Has tools: ${call0.hasTools}`);
  console.log(`  Has system prompt: ${call0.content !== null}`);
  
  console.log('\nCALL 1:');
  console.log(`  Index: ${call1.idx}`);
  console.log(`  Timestamp: ${call1.timestamp}`);
  console.log(`  Has tools: ${call1.hasTools}`);
  console.log(`  Has system prompt: ${call1.content !== null}`);

  console.log('\n' + '='.repeat(80));
  console.log('SYSTEM PROMPT COMPARISON:');
  console.log('='.repeat(80));

  if (!call0.content && !call1.content) {
    console.log('Both calls have NO system prompt');
  } else if (!call0.content && call1.content) {
    console.log(`\nCall 0: NO SYSTEM PROMPT`);
    console.log(`\nCall 1: HAS SYSTEM PROMPT (${call1.content.length} chars)`);
    console.log('\n--- Call 1 System Prompt (first 500 chars) ---');
    console.log(call1.content.substring(0, 500));
  } else if (call0.content && !call1.content) {
    console.log(`\nCall 0: HAS SYSTEM PROMPT (${call0.content.length} chars)`);
    console.log('\n--- Call 0 System Prompt (first 500 chars) ---');
    console.log(call0.content.substring(0, 500));
    console.log('\nCall 1: NO SYSTEM PROMPT');
  } else {
    // Both have system prompts - compare them
    if (call0.content === call1.content) {
      console.log('System prompts are IDENTICAL');
    } else {
      console.log(`Call 0: ${call0.content.length} chars`);
      console.log(`Call 1: ${call1.content.length} chars`);
      console.log('\nDIFFERENCES:');
      
      const baseLines = call0.content.split('\n');
      const currLines = call1.content.split('\n');
      
      let diffCount = 0;
      for (let line = 0; line < Math.max(baseLines.length, currLines.length); line++) {
        const baseLine = baseLines[line];
        const currLine = currLines[line];
        
        if (baseLine !== currLine) {
          console.log(`\n  Line ${line}:`);
          console.log(`    Call 0: ${baseLine?.substring(0, 80) || '(missing)'}`);
          console.log(`    Call 1: ${currLine?.substring(0, 80) || '(missing)'}`);
          diffCount++;
          if (diffCount >= 5) {
            console.log('  ... (showing first 5 differences)');
            break;
          }
        }
      }
    }
  }

  db.close();
}

compareSystemPrompts().catch(console.error);
