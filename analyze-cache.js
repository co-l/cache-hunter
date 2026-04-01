#!/usr/bin/env node
import { execSync } from 'child_process';

const DB_PATH = 'cache-hunter.db';

console.log('Cache Hunter - Cache Invalidation Pattern Detection\n');
console.log('='.repeat(80));

console.log('1. LATENCY TRENDS OVER TIME');
console.log('-'.repeat(80));
console.log('Look for decreasing ms/token in conversations (cache working):\n');
try {
  execSync(`sqlite3 -header -column ${DB_PATH} "SELECT 
    datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
    prompt_tokens,
    duration_ms,
    round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token
  FROM responses 
  WHERE prompt_tokens IS NOT NULL AND prompt_tokens > 0
  ORDER BY timestamp
  LIMIT 15;"`, { stdio: 'inherit' });
} catch (e) {}

console.log('\n\n2. PREFIX OVERLAP ANALYSIS');
console.log('-'.repeat(80));
console.log('Requests with same prefix should be faster if caching works:\n');
try {
  execSync(`sqlite3 -header -column ${DB_PATH} "SELECT 
    substr(r.body, 1, 60) as prefix,
    count(*) as occurrences,
    round(avg(resp.duration_ms), 0) as avg_duration_ms,
    round(avg(resp.duration_ms * 1.0 / NULLIF(resp.prompt_tokens, 0)), 2) as avg_ms_per_token
  FROM requests r
  JOIN responses resp ON r.id = resp.request_id
  WHERE r.path = '/v1/chat/completions'
  GROUP BY substr(r.body, 1, 60)
  HAVING count(*) > 1
  ORDER BY occurrences DESC;"`, { stdio: 'inherit' });
} catch (e) {}

console.log('\n\n3. CONVERSATIONAL CHAIN DETECTION');
console.log('-'.repeat(80));
console.log('Multi-turn conversations should show improving efficiency:\n');
try {
  execSync(`sqlite3 -header -column ${DB_PATH} "SELECT 
    substr(r.body, instr(r.body, '\\\"model\\\":\\\"'), 40) as model_key,
    count(*) as turns,
    round(avg(resp.duration_ms), 0) as avg_duration,
    round(avg(resp.prompt_tokens), 0) as avg_tokens,
    min(datetime(r.timestamp/1000, 'unixepoch', 'localtime')) as first_turn,
    max(datetime(r.timestamp/1000, 'unixepoch', 'localtime')) as last_turn
  FROM requests r
  JOIN responses resp ON r.id = resp.request_id
  WHERE r.path = '/v1/chat/completions'
  GROUP BY substr(r.body, instr(r.body, '\\\"model\\\":\\\"'), 40)
  HAVING count(*) > 1
  ORDER BY turns DESC;"`, { stdio: 'inherit' });
} catch (e) {
  console.log('No conversation chains detected (need more data)');
}

console.log('\n\n4. LATENCY DISTRIBUTION (Bimodal Check)');
console.log('-'.repeat(80));
console.log('Two distinct clusters = cache hits vs misses:\n');
try {
  execSync(`sqlite3 -header -column ${DB_PATH} "SELECT 
    CASE 
      WHEN duration_ms < 500 THEN '<500ms (fast)'
      WHEN duration_ms < 2000 THEN '500-2000ms (medium)'
      ELSE '>2000ms (slow)'
    END as latency_bucket,
    count(*) as count,
    round(avg(duration_ms), 0) as avg_ms,
    round(avg(prompt_tokens), 0) as avg_tokens
  FROM responses
  WHERE prompt_tokens IS NOT NULL
  GROUP BY latency_bucket
  ORDER BY avg_ms;"`, { stdio: 'inherit' });
} catch (e) {}

console.log('\n\n5. CACHE INVALIDATION INDICATORS');
console.log('-'.repeat(80));
console.log('Requests with unusually high latency (potential cache misses):\n');
try {
  execSync(`sqlite3 -header -column ${DB_PATH} "SELECT 
    datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
    prompt_tokens,
    duration_ms,
    round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token
  FROM responses
  WHERE prompt_tokens IS NOT NULL 
    AND prompt_tokens > 0
    AND duration_ms > (SELECT avg(duration_ms) * 2 FROM responses WHERE prompt_tokens > 0)
  ORDER BY timestamp;"`, { stdio: 'inherit' });
} catch (e) {}

console.log('\n\n6. EFFICIENCY TREND');
console.log('-'.repeat(80));
console.log('If caching works, ms/token should decrease as tokens increase:\n');
try {
  execSync(`sqlite3 -header -column ${DB_PATH} "SELECT 
    prompt_tokens,
    duration_ms,
    round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token,
    CASE 
      WHEN prompt_tokens < 100 THEN 'small'
      WHEN prompt_tokens < 500 THEN 'medium'
      ELSE 'large'
    END as size_category
  FROM responses
  WHERE prompt_tokens IS NOT NULL AND prompt_tokens > 0
  ORDER BY prompt_tokens;"`, { stdio: 'inherit' });
} catch (e) {}

console.log('\n\n7. SUMMARY STATISTICS');
console.log('-'.repeat(80));
try {
  execSync(`sqlite3 -header -column ${DB_PATH} "SELECT 
    count(*) as total_requests,
    round(avg(duration_ms), 0) as avg_duration,
    round(min(duration_ms), 0) as min_duration,
    round(max(duration_ms), 0) as max_duration,
    round(avg(prompt_tokens), 0) as avg_prompt_tokens,
    round(avg(duration_ms * 1.0 / prompt_tokens), 2) as avg_ms_per_token
  FROM responses
  WHERE prompt_tokens IS NOT NULL AND prompt_tokens > 0;"`, { stdio: 'inherit' });
} catch (e) {}

console.log('\n\n='.repeat(80));
console.log('\nFor detailed analysis, run: npx tsx src/analyze-patterns.ts');
console.log('For visualization data: cat cache-analysis.csv');
