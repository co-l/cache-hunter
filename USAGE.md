# Cache Hunter - Usage Guide

## Quick Start

### 1. Start the Proxy
```bash
cd /home/conrad/dev/cache-hunter
npm start
```

The proxy will:
- Listen on `http://localhost:8787`
- Forward to vLLM at `http://192.168.1.223:8000`
- Create `cache-hunter.db` for logging

### 2. Point OpenFox to the Proxy
```bash
export OPENAI_BASE_URL=http://localhost:8787
```

### 3. Run OpenFox Normally
All traffic will be logged transparently to `cache-hunter.db`

### 4. Query the Logs
```bash
sqlite3 cache-hunter.db
node analyze-cache.js
node query-examples.js
```

## Debugging Cache Behavior

### Understanding vLLM Prefix Caching

vLLM caches KV blocks at the **16-token block level** using hash-based caching:
- **Transparent**: No cache hit/miss signals in API
- **Block-level**: Caches full blocks only
- **Hash-based**: Uses SHA256 of (parent_hash + tokens + extras)

### How to Detect Cache Behavior

Since vLLM doesn't expose cache signals, we infer from **timing patterns**:

#### 1. Look for Bimodal Latency Distribution

```sql
SELECT 
  prompt_tokens,
  duration_ms,
  round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token
FROM responses
WHERE prompt_tokens > 100
ORDER BY ms_per_token;
```

**What to look for:**
- Low ms/token = likely cache hit
- High ms/token = likely cache miss

#### 2. Find Prefix Overlaps

```sql
SELECT 
  datetime(r1.timestamp/1000, 'unixepoch', 'localtime') as first,
  datetime(r2.timestamp/1000, 'unixepoch', 'localtime') as second,
  substr(r1.body, 1, 100) as shared_prefix
FROM requests r1
JOIN requests r2 ON r2.timestamp > r1.timestamp
WHERE r1.path = '/v1/chat/completions'
  AND r2.path = '/v1/chat/completions'
  AND r2.body LIKE r1.body || '%'
ORDER BY r2.timestamp DESC
LIMIT 5;
```

**What to look for:**
- If second request is faster = cache hit
- If same speed = cache miss

#### 3. Timeline Analysis

```sql
SELECT 
  datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
  duration_ms,
  prompt_tokens
FROM responses
ORDER BY timestamp;
```

**What to look for:**
- Sudden latency spikes = potential cache invalidation

#### 4. Token Efficiency

```sql
SELECT 
  prompt_tokens,
  round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token
FROM responses
WHERE prompt_tokens > 50
ORDER BY prompt_tokens DESC;
```

**What to look for:**
- Decreasing ms/token as tokens increase = caching works
- Constant ms/token = no cache benefit

## Example: Debug Conversation Caching

1. Start proxy: `npm start`

2. Run multi-turn conversation with OpenFox

3. Query results:
```sql
SELECT 
  prompt_tokens,
  duration_ms,
  round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token
FROM responses
ORDER BY prompt_tokens;
```

**If caching works:**
- Turn 1: 100 tokens, 5.0 ms/token
- Turn 2: 200 tokens, 3.0 ms/token (faster!)
- Turn 3: 300 tokens, 2.3 ms/token (even faster!)

**If caching broken:**
- All turns show ~5.0 ms/token (linear scaling)

## Troubleshooting

### Proxy won't start
```bash
pkill -f "tsx src/index.ts"
npm start
```

### No data in database
```bash
curl http://localhost:8787/v1/models
sqlite3 cache-hunter.db "SELECT count(*) FROM requests;"
```

### vLLM unreachable
```bash
curl http://192.168.1.223:8000/v1/models
```

## Cleanup

```bash
rm cache-hunter.db
```
