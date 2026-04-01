#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';
import initSqlJs, { Database } from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'cache-hunter.db');

async function analyzeCachePatterns() {
  const SQL = await initSqlJs();
  
  const data = readFileSync(DB_PATH);
  const db = new SQL.Database(data);

  console.log('Cache Hunter - Cache Invalidation Pattern Analysis\n');
  console.log('='.repeat(80));

  analyzeLatencyTrends(db);
  analyzePrefixPatterns(db);
  analyzeConversationalChains(db);
  exportForVisualization(db);

  db.close();
}

function analyzeLatencyTrends(db: Database) {
  console.log('\n1. LATENCY TRENDS OVER TIME');
  console.log('-'.repeat(80));
  
  const query = `
    SELECT 
      datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
      prompt_tokens,
      duration_ms,
      round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token
    FROM responses
    WHERE prompt_tokens IS NOT NULL AND prompt_tokens > 0
    ORDER BY timestamp
    LIMIT 20
  `;
  
  const results = db.exec(query);
  if (results.length === 0) {
    console.log('No data available');
    return;
  }

  const rows = results[0].values;
  const headers = results[0].columns;
  
  console.log(headers.join('\t'));
  rows.forEach(row => {
    console.log(row.join('\t'));
  });

  const avgMsPerToken = db.exec(`
    SELECT round(avg(duration_ms * 1.0 / prompt_tokens), 2) as avg_ms_per_token
    FROM responses
    WHERE prompt_tokens IS NOT NULL AND prompt_tokens > 0
  `);
  
  if (avgMsPerToken.length > 0) {
    console.log(`\nAverage ms/token: ${avgMsPerToken[0].values[0][0]}`);
  }
}

function analyzePrefixPatterns(db: Database) {
  console.log('\n\n2. PREFIX HASH ANALYSIS');
  console.log('-'.repeat(80));
  console.log('Grouping requests by first 50 chars of body (simulating hash buckets):\n');

  const query = `
    SELECT 
      substr(r.body, 1, 50) as prefix,
      count(*) as occurrences,
      round(avg(resp.duration_ms), 0) as avg_duration,
      round(avg(resp.duration_ms * 1.0 / NULLIF(resp.prompt_tokens, 0)), 2) as avg_ms_per_token
    FROM requests r
    JOIN responses resp ON r.id = resp.request_id
    WHERE r.path = '/v1/chat/completions'
    GROUP BY substr(r.body, 1, 50)
    HAVING count(*) > 1
    ORDER BY occurrences DESC
  `;

  const results = db.exec(query);
  if (results.length === 0 || results[0].values.length === 0) {
    console.log('No repeated prefixes found (expected for unique conversations)');
    return;
  }

  const rows = results[0].values;
  console.log('Prefix\tOccurrences\tAvg Duration\tAvg ms/token');
  rows.forEach(row => {
    console.log(`${row[0]}...\t${row[1]}\t${row[2]}ms\t${row[3]}`);
  });
}

function analyzeConversationalChains(db: Database) {
  console.log('\n\n3. CONVERSATIONAL CHAIN DETECTION');
  console.log('-'.repeat(80));
  console.log('Detecting multi-turn conversations by matching model names:\n');

  const query = `
    WITH conversation_groups AS (
      SELECT 
        r.id,
        r.timestamp,
        r.body,
        resp.prompt_tokens,
        resp.duration_ms,
        substr(r.body, instr(r.body, '"model":"'), 50) as model_key,
        datetime(r.timestamp/1000, 'unixepoch', 'localtime') as time
      FROM requests r
      JOIN responses resp ON r.id = resp.request_id
      WHERE r.path = '/v1/chat/completions'
    )
    SELECT 
      model_key,
      count(*) as turns,
      round(avg(duration_ms), 0) as avg_duration,
      round(avg(prompt_tokens), 0) as avg_tokens,
      min(time) as first_turn,
      max(time) as last_turn
    FROM conversation_groups
    GROUP BY model_key
    HAVING count(*) > 1
    ORDER BY turns DESC
  `;

  const results = db.exec(query);
  if (results.length === 0 || results[0].values.length === 0) {
    console.log('No conversation chains detected');
    return;
  }

  const rows = results[0].values;
  console.log('Model Key\tTurns\tAvg Duration\tAvg Tokens\tFirst Turn\tLast Turn');
  rows.forEach(row => {
    console.log(`${row[0]}\t${row[1]}\t${row[2]}ms\t${row[3]}\t${row[4]}\t${row[5]}`);
  });

  console.log('\nDetailed chain progression:');
  const detailQuery = `
    SELECT 
      datetime(r.timestamp/1000, 'unixepoch', 'localtime') as time,
      resp.prompt_tokens,
      resp.duration_ms,
      round(resp.duration_ms * 1.0 / NULLIF(resp.prompt_tokens, 0), 2) as ms_per_token,
      substr(r.body, 1, 80) as preview
    FROM requests r
    JOIN responses resp ON r.id = resp.request_id
    WHERE r.path = '/v1/chat/completions'
    ORDER BY r.timestamp
    LIMIT 10
  `;
  
  const detailResults = db.exec(detailQuery);
  if (detailResults.length > 0) {
    console.log('Time\tTokens\tDuration\tms/token\tPreview');
    detailResults[0].values.forEach(row => {
      console.log(`${row[0]}\t${row[1]}\t${row[2]}ms\t${row[3]}\t${row[4]}...`);
    });
  }
}

function exportForVisualization(db: Database) {
  console.log('\n\n4. EXPORTING DATA FOR VISUALIZATION');
  console.log('-'.repeat(80));

  const query = `
    SELECT 
      r.id as request_id,
      datetime(r.timestamp/1000, 'unixepoch', 'localtime') as timestamp,
      r.path,
      r.body as request_body,
      resp.duration_ms,
      resp.prompt_tokens,
      resp.completion_tokens,
      resp.total_tokens,
      round(resp.duration_ms * 1.0 / NULLIF(resp.prompt_tokens, 0), 2) as ms_per_token
    FROM requests r
    JOIN responses resp ON r.id = resp.request_id
    ORDER BY r.timestamp
  `;

  const results = db.exec(query);
  if (results.length > 0) {
    const csvPath = join(__dirname, '..', 'cache-analysis.csv');
    const headers = results[0].columns.join(',');
    const rows = results[0].values.map(row => 
      row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')
    );
    const csv = [headers, ...rows].join('\n');
    writeFileSync(csvPath, csv);
    console.log(`Exported ${results[0].values.length} rows to: ${csvPath}`);
    console.log('\nYou can open this in Excel, Google Sheets, or your favorite visualization tool');
  }
}

analyzeCachePatterns().catch(console.error);
