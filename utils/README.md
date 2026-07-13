# Cache-Hunter Utilities

## test-cache-cross.ts

Cross-path KV-cache test for vLLM. Detects whether prefix cache hits survive
when switching between direct and proxied connections, and whether request
parameters (like `reasoning_effort`) affect cache locality.

```bash
npx tsx utils/test-cache-cross.ts \
  --direct-url http://192.168.1.223:8000 \
  --proxy-url http://localhost:8787 \
  --model "deepseek-v4-flash" \
  --context-tokens 15000 \
  --reasoning-effort max \
  --compare-reasoning-effort high
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--direct-url` | `http://192.168.1.223:8000` | Base URL for direct vLLM access |
| `--proxy-url` | `http://localhost:8787` | Base URL for cache-hunter proxy |
| `--model` | `''` (server default) | Model name to use |
| `--context-tokens` | `15000` | Approximate context size in tokens |
| `--seed` | `42` | RNG seed for deterministic context |
| `--threshold` | `2.0` | TTFT threshold (seconds) below which is considered a cache HIT |
| `--reasoning-effort` | — | Value for `reasoning_effort` param sent with all requests |
| `--compare-reasoning-effort` | — | If set, adds a phase comparing two `reasoning_effort` values on the same context |

### What it does

1. Generates a unique pseudo-random document per phase (seeded PRNG, no collisions)
2. Runs four standard phases plus an optional comparison phase:
   - **Direct ×2** — cold then warm (baseline)
   - **Proxy ×2** — cold then warm (proxy baseline)
   - **Proxy → Direct** — hydrate via proxy, then direct (cross check)
   - **Direct → Proxy** — hydrate direct, then via proxy (reverse cross)
   - **EffortCompare** *(optional)* — same context, two `reasoning_effort` values
3. Measures **TTFT** (time to first token) for each request
4. Classifies each as **HIT** or **MISS** based on threshold
5. Reports whether cache survives path switches and param changes

### Key finding: `reasoning_effort` busts the cache

If your client sends different `reasoning_effort` values to different endpoints
(e.g. `"max"` direct vs `"high"` via proxy), vLLM treats them as separate cache
keys — the prefix cache is **not shared** between requests with differing
`reasoning_effort` values, even with identical context and model.

Use `--reasoning-effort` and `--compare-reasoning-effort` to test this yourself.

### Example output

```
  ==============================================
   Cache-Hunter --- Cross-Path Cache Test
  ==============================================
  Context:   ~15,000 tokens (60,000 chars)
  Base seed: 42
  Model:     deepseek-v4-flash
  Reasoning: max
  Compare:   reasoning_effort max vs high
  Direct:    http://192.168.1.223:8000
  Proxy:     http://localhost:8787
  Threshold: TTFT < 2s -> HIT, >= 2s -> MISS

  --- Direct (effort=max) (ctx seed 42) ---
  [Direct #1 (cold)]... TTFT=7.480s effort=max -> MISS
  [Direct #2 (warm)]... TTFT=0.313s effort=max -> HIT
  --- Proxy (effort=max) (ctx seed 10015) ---
  [Proxy #1 (cold)]... TTFT=8.575s effort=max -> MISS
  [Proxy #2 (warm)]... TTFT=0.356s effort=max -> HIT
  --- Proxy→Direct (effort=max) (ctx seed 19988) ---
  [Proxy→Direct #1 (via proxy)]... TTFT=7.501s effort=max -> MISS
  [Proxy→Direct #2 (via direct)]... TTFT=0.299s effort=max -> HIT
  --- Direct→Proxy (effort=max) (ctx seed 29961) ---
  [Direct→Proxy #1 (via direct)]... TTFT=7.455s effort=max -> MISS
  [Direct→Proxy #2 (via proxy)]... TTFT=1.459s effort=max -> HIT
  --- EffortCompare (effort varies) (ctx seed 39934) ---
  [EffortCompare #1 (effort=max)]... TTFT=7.630s effort=max -> MISS
  [EffortCompare #2 (effort=high)]... TTFT=8.098s effort=high -> MISS

  --- Results ---
  Step                                   |  TTFT (s) |   E2E (s) |   Out |  Prompt | Verdict
  ---------------------------------------+-----------+-----------+-------+---------+--------
  Direct #1 (cold)                       |     7.480 |     9.879 |    43 |   14949 | MISS
  Direct #2 (warm)                       |     0.313 |     2.483 |    39 |   14949 | HIT
  Proxy #1 (cold)                        |     8.575 |    10.717 |    38 |   14963 | MISS
  Proxy #2 (warm)                        |     0.356 |     2.546 |    39 |   14963 | HIT
  Proxy→Direct #1 (via proxy)            |     7.501 |     9.710 |    39 |   14913 | MISS
  Proxy→Direct #2 (via direct)           |     0.299 |     2.683 |    43 |   14913 | HIT
  Direct→Proxy #1 (via direct)           |     7.455 |     9.594 |    38 |   14899 | MISS
  Direct→Proxy #2 (via proxy)            |     1.459 |     4.228 |    41 |   14899 | HIT
  EffortCompare #1 (effort=max)          |     7.630 |    11.082 |    41 |   14907 | MISS
  EffortCompare #2 (effort=high)         |     8.098 |    13.495 |    51 |   14828 | MISS

  ✓ Cache warmed via proxy is visible via direct
  ✓ Cache warmed via direct is visible via proxy
  ⚠ EffortCompare #2 should be a HIT (same context) — got MISS
  SOME CHECKS FAILED --- see analysis above
```
