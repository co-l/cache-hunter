#!/usr/bin/env node
import { execSync } from 'child_process';

const DB_PATH = process.argv[2] || 'cache-hunter.db';

console.log('Cache Hunter - Query Examples\n');
console.log('='.repeat(50));

console.log('\n1. Recent Requests (last 10):');
console.log('-'.repeat(50));
execSync(`sqlite3 -header -column ${DB_PATH} "SELECT datetime(r.timestamp/1000, 'unixepoch', 'localtime') as time, method, r.path, status_code, duration_ms FROM requests r JOIN responses resp ON r.id = resp.request_id ORDER BY r.timestamp DESC LIMIT 10;"`, { stdio: 'inherit' });

console.log('\n2. Requests with Token Usage:');
console.log('-'.repeat(50));
execSync(`sqlite3 -header -column ${DB_PATH} "SELECT datetime(r.timestamp/1000, 'unixepoch', 'localtime') as time, r.path, prompt_tokens, completion_tokens, total_tokens, duration_ms FROM responses JOIN requests r ON responses.request_id = r.id WHERE prompt_tokens IS NOT NULL ORDER BY r.timestamp DESC LIMIT 10;"`, { stdio: 'inherit' });

console.log('\n3. Latency per Token (potential cache misses at top):');
console.log('-'.repeat(50));
execSync(`sqlite3 -header -column ${DB_PATH} "SELECT datetime(r.timestamp/1000, 'unixepoch', 'localtime') as time, r.path, prompt_tokens, duration_ms, round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token FROM responses JOIN requests r ON responses.request_id = r.id WHERE prompt_tokens > 10 ORDER BY ms_per_token DESC LIMIT 15;"`, { stdio: 'inherit' });

console.log('\n4. Find Similar Prefixes:');
console.log('-'.repeat(50));
execSync(`sqlite3 -header -column ${DB_PATH} "SELECT r1.id as req1, r2.id as req2, substr(r1.body, 1, 80) as prefix FROM requests r1 JOIN requests r2 ON r2.timestamp > r1.timestamp WHERE r1.path = '/v1/chat/completions' AND r2.path = '/v1/chat/completions' AND r2.body LIKE r1.body || '%' AND length(r1.body) > 50 ORDER BY r2.timestamp DESC LIMIT 5;"`, { stdio: 'inherit' });

console.log('\n5. Timeline View:');
console.log('-'.repeat(50));
execSync(`sqlite3 -header -column ${DB_PATH} "SELECT datetime(r.timestamp/1000, 'unixepoch', 'localtime') as time, r.path, duration_ms, prompt_tokens FROM responses JOIN requests r ON responses.request_id = r.id ORDER BY r.timestamp LIMIT 20;"`, { stdio: 'inherit' });

console.log('\n' + '='.repeat(50));
console.log('Tip: Use sqlite3 cache-hunter.db for interactive queries');
