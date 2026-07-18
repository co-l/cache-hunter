# Cache Hunter

Transparent proxy for OpenAI-API compatible endpoints with SQLite logging to debug prefix caching behavior.

## Quick Start

```bash
# Install
npm install

# Start proxy
npm start

# Point Harness to the proxy
export OPENAI_BASE_URL=http://localhost:8787

# Run your Harness tool as normal — all traffic gets logged
```

## Architecture

```
Harness → Proxy (localhost:8787) → OpenAI-API endpoint (127.0.0.1:8000)
                                   ↓
                             cache-hunter.db
```

## Configuration

Set via environment variables (or persisted from the UI):
- `TARGET_HOST` (default: `127.0.0.1`)
- `TARGET_PORT` (default: `8000`)
- `PROXY_PORT` (default: `8787`)
- `WEB_PORT` (default: `4000`)

## Database Schema

### requests
- `id` - UUID for correlation
- `timestamp` - Unix ms
- `method` - HTTP method
- `path` - Request path
- `headers` - JSON string
- `body` - Full request body (JSON string)
- `cache_salt` - Extracted if present in body
- `client_ip` - Client IP address

### responses
- `request_id` - FK to requests.id
- `timestamp` - Unix ms
- `status_code` - HTTP status
- `headers` - JSON string
- `body` - Full response body (JSON string)
- `duration_ms` - Total request duration
- `prompt_tokens` - From usage.prompt_tokens
- `completion_tokens` - From usage.completion_tokens
- `total_tokens` - From usage.total_tokens

## Query Examples

### Basic queries
```bash
node query-examples.js
```

### Cache analysis
```bash
node analyze-cache.js
```

### Advanced pattern detection
```bash
npm run analyze
```

### Context coherence verification
```bash
npm run demo
npm run tree
```

This provides:
- Latency trends over time
- Prefix hash analysis
- Conversational chain detection
- Cache invalidation indicators
- CSV export for visualization

### Manual queries
```bash
sqlite3 cache-hunter.db

-- Recent requests
SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
       path, duration_ms, prompt_tokens
FROM responses
ORDER BY timestamp DESC
LIMIT 10;

-- Find requests with similar prefixes
SELECT r1.id, r2.id, substr(r1.body, 1, 100) as prefix
FROM requests r1
JOIN requests r2 ON r2.timestamp > r1.timestamp
WHERE r1.path = '/v1/chat/completions'
  AND r2.path = '/v1/chat/completions'
  AND r2.body LIKE r1.body || '%'
ORDER BY r2.timestamp DESC
LIMIT 5;

-- Latency per token (high values = potential cache misses)
SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
       prompt_tokens,
       duration_ms,
       round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token
FROM responses
WHERE prompt_tokens > 50
ORDER BY ms_per_token DESC;
```

## Debugging Cache Behavior

vLLM's prefix caching is **transparent** - it doesn't expose cache hit/miss signals. To detect caching behavior:

### 1. Latency Analysis
Cache hits should show **lower ms/token** for requests with similar prefixes:
```sql
SELECT prompt_tokens, duration_ms,
       round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token
FROM responses
WHERE prompt_tokens > 100
ORDER BY ms_per_token;
```

### 2. Prefix Overlap Detection
Find requests that share prefixes:
```sql
SELECT r1.body as req1, r2.body as req2
FROM requests r1, requests r2
WHERE r2.body LIKE r1.body || '%'
  AND length(r1.body) > 100
  AND length(r1.body) < length(r2.body);
```

### 3. Timeline Analysis
Look for latency patterns over time:
```sql
SELECT datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
       duration_ms, prompt_tokens
FROM responses
ORDER BY timestamp;
```

## Features

- ✅ **100% Transparent**: Forwards all requests as-is
- ✅ **SSE Streaming**: Supports `/v1/chat/completions` streaming
- ✅ **Async Logging**: Non-blocking SQLite writes
- ✅ **Correlation IDs**: `x-proxy-request-id` header for tracing
- ✅ **Token Metrics**: Logs prompt/completion/total tokens
- ✅ **Timing Data**: Precise duration measurements
- ✅ **Context Verification**: Hash-based tree to verify conversation coherence

## Limitations

- **No cache signals**: vLLM doesn't expose cache hit/miss
- **Network latency**: Duration includes localhost→vLLM network time
- **Memory queue**: In-memory write queue (flushed every 100ms or 50 requests)

## Cleanup

```bash
# Remove all logs
rm cache-hunter.db
```

## How It Works

1. **Proxy intercepts** all HTTP requests to the upstream endpoint
2. **Captures request** body, headers, timestamp
3. **Forwards transparently** to the target (127.0.0.1:8000)
4. **Captures response** body, headers, duration, token counts
5. **Logs to SQLite** asynchronously (batched writes)
6. **Adds correlation ID** header (`x-proxy-request-id`)

## Development

```bash
# Watch mode
npm run dev

# Direct TypeScript execution
npx tsx src/index.ts
```
