# Cache Invalidation Pattern Detection

## Overview

This tool analyzes vLLM prefix caching behavior by detecting patterns in request/response timing data.

## Key Metrics

### 1. ms/token (Latency per Token)
- **Formula**: `duration_ms / prompt_tokens`
- **Interpretation**:
  - Lower values = likely cache hit
  - Higher values = likely cache miss
  - Look for bimodal distribution (two distinct clusters)

### 2. Prefix Overlap
- Requests with identical prefixes should show improved latency if caching works
- Group requests by first 50 chars of body to simulate hash buckets

### 3. Conversational Chains
- Multi-turn conversations should show decreasing ms/token over time
- Each turn builds on previous context (more tokens, same or lower latency)

## Running Analysis

```bash
# Analyze current database
npx tsx src/analyze-patterns.ts

# View exported CSV
cat cache-analysis.csv
```

## Interpreting Results

### Cache Hit Indicators
- ✅ Decreasing ms/token in conversation chains
- ✅ Repeated prefixes show lower avg_duration
- ✅ Bimodal latency distribution (fast vs slow clusters)

### Cache Miss Indicators
- ❌ Constant ms/token across similar requests
- ❌ No correlation between prefix overlap and latency
- ❌ Linear scaling (latency increases proportionally with tokens)

### Invalidation Patterns to Watch

1. **Time-based invalidation**: Cache clears after certain interval
   - Look for sudden latency spikes after periods of low activity

2. **Memory pressure**: Cache evicted due to memory constraints
   - Look for latency returning to baseline after many requests

3. **Model switching**: Different models = different cache keys
   - Requests to different models won't share cache

## Example Output

```
1. LATENCY TRENDS OVER TIME
time                 prompt_tokens  duration_ms  ms_per_token
2026-04-01 16:08:48  120            601          5.01

Average ms/token: 5.01

2. PREFIX HASH ANALYSIS
Prefix                                    Occurrences  Avg Duration  Avg ms/token
{"model":"Intel/Qwen3.5-397B...",         10           6537ms        5.01

3. CONVERSATIONAL CHAIN DETECTION
Model Key                                  Turns  Avg Duration  Avg Tokens
"model":"Intel/Qwen3.5-397B...",          10     6537ms        120
```

## Advanced Queries

### Detect Cache Efficiency
```sql
SELECT 
  prompt_tokens,
  duration_ms,
  round(duration_ms * 1.0 / prompt_tokens, 2) as ms_per_token
FROM responses
WHERE prompt_tokens > 50
ORDER BY prompt_tokens DESC;
```

**Expected if caching works**: ms/token decreases as prompt_tokens increases

### Find Cache Invalidation Points
```sql
SELECT 
  datetime(timestamp/1000, 'unixepoch', 'localtime') as time,
  duration_ms,
  prompt_tokens
FROM responses
WHERE duration_ms > (
  SELECT avg(duration_ms) * 2 FROM responses
)
ORDER BY timestamp;
```

Shows requests with unusually high latency (potential cache misses)

### Conversation Turn Analysis
```sql
WITH turns AS (
  SELECT 
    r.id,
    resp.prompt_tokens,
    resp.duration_ms,
    row_number() OVER (ORDER BY r.timestamp) as turn_number
  FROM requests r
  JOIN responses resp ON r.id = resp.request_id
  WHERE r.path = '/v1/chat/completions'
)
SELECT 
  turn_number,
  avg(prompt_tokens) as avg_tokens,
  avg(duration_ms) as avg_duration,
  avg(duration_ms * 1.0 / prompt_tokens) as avg_ms_per_token
FROM turns
GROUP BY turn_number
ORDER BY turn_number;
```

Shows how latency evolves across conversation turns

## Export Format

The analysis exports to CSV with columns:
- `request_id`: Unique identifier
- `timestamp`: When request occurred
- `path`: API endpoint
- `request_body`: Full request (for prefix analysis)
- `duration_ms`: Total request time
- `prompt_tokens`: Input tokens
- `completion_tokens`: Output tokens
- `total_tokens`: Sum
- `ms_per_token`: Efficiency metric

## Limitations

1. **Inferred metrics**: vLLM doesn't expose cache hit/miss directly
2. **Network latency**: Includes localhost→vLLM network time
3. **Block-level caching**: vLLM caches in 16-token blocks
4. **Sample size**: Need sufficient requests for statistical significance

## Next Steps

1. Run analysis on larger datasets (100+ requests)
2. Compare ms/token distributions across different models
3. Test with controlled prefix variations
4. Monitor over extended periods (hours/days)
