#!/usr/bin/env tsx
/**
 * test-cache-cross.ts — Cross-path KV-cache test for vLLM
 *
 * Measures TTFT (time to first token) to detect prefix cache hits
 * when switching between direct and proxied connections.
 *
 * Each phase uses a FRESH context (unique seed) so results aren't
 * polluted by cache hits cascading from previous phases.
 *
 * Usage:
 *   npx tsx utils/test-cache-cross.ts \
 *     --direct-url http://192.168.1.223:8000 \
 *     --proxy-url http://localhost:8787 \
 *     --model "my-model" \
 *     --context-tokens 10000
 */

import { request as httpRequest, RequestOptions } from 'http';
import { performance } from 'perf_hooks';

// ── CLI ────────────────────────────────────────────────────────────

interface CliArgs {
  directUrl: string;
  proxyUrl: string;
  model: string;
  contextTokens: number;
  seed: number;
  threshold: number;
  reasoningEffort: string | null;
  compareReasoningEffort: string | null;
}

function parseCli(): CliArgs {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts[key] = args[++i];
      } else {
        opts[key] = 'true';
      }
    }
  }
  return {
    directUrl: opts['direct-url'] || 'http://192.168.1.223:8000',
    proxyUrl: opts['proxy-url'] || 'http://localhost:8787',
    model: opts['model'] || '',
    contextTokens: parseInt(opts['context-tokens'] || '15000', 10),
    seed: parseInt(opts['seed'] || '42', 10),
    threshold: parseFloat(opts['threshold'] || '2.0'),
    reasoningEffort: opts['reasoning-effort'] || null,
    compareReasoningEffort: opts['compare-reasoning-effort'] || null,
  };
}

// ── Context generation ─────────────────────────────────────────────
// Seeded pseudo-random text generator. Every seed produces a completely
// unique document — no rotation collisions, no repeated corpus.

function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

const WORDS = [
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'it',
  'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this',
  'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or',
  'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
  'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
  'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come',
  'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how',
  'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because',
  'any', 'these', 'give', 'day', 'most', 'us', 'analyse', 'compute',
  'evaluate', 'synthesize', 'determine', 'classify', 'compare',
  'contrast', 'define', 'demonstrate', 'derive', 'describe',
  'design', 'develop', 'identify', 'illustrate', 'implement',
  'interpret', 'investigate', 'measure', 'optimize', 'predict',
  'prove', 'resolve', 'simulate', 'solve', 'specify', 'validate',
  'abstract', 'algorithm', 'architecture', 'component', 'configuration',
  'constraint', 'context', 'correlation', 'dependency', 'distribution',
  'framework', 'function', 'implementation', 'instance', 'interface',
  'mechanism', 'methodology', 'module', 'parameter', 'phenomenon',
  'principle', 'procedure', 'process', 'protocol', 'representation',
  'resolution', 'semantic', 'sequence', 'structure', 'technique',
];

function generateContext(seed: number, charCount: number): string {
  const rng = seededRand(seed);
  const sentences: string[] = [];
  let total = 0;
  while (total < charCount) {
    const nWords = Math.floor(rng() * 12) + 3;
    const words: string[] = [];
    for (let i = 0; i < nWords; i++) {
      words.push(WORDS[Math.floor(rng() * WORDS.length)]);
    }
    const sentence = words[0].charAt(0).toUpperCase() + words.slice(1).join(' ') + '.';
    sentences.push(sentence);
    total += sentence.length + 1;
  }
  return sentences.join(' ');
}

// ── SSE streaming ──────────────────────────────────────────────────

interface StreamResult {
  ttft: number;
  e2e: number;
  outputTokens: number;
  promptTokens: number | null;
  error: string | null;
}

function streamComplete(url: string, body: string, timeoutSec: number): Promise<StreamResult> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const t0 = performance.now();
    let ttft = 0;
    let firstContentSeen = false;
    let outputTokens = 0;
    let promptTokens: number | null = null;
    let error: string | null = null;
    let buffer = '';
    let finished = false;

    const finish = (err?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const e2e = (performance.now() - t0) / 1000;
      if (!firstContentSeen) ttft = e2e;
      if (err) error = err;
      resolve({ ttft, e2e, outputTokens, promptTokens, error });
    };

    const timer = setTimeout(() => finish('timeout'), timeoutSec * 1000);

    const options: RequestOptions = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = httpRequest(options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let errBody = '';
        res.on('data', (chunk: Buffer) => { errBody += chunk.toString('utf-8'); });
        res.on('end', () => finish(`HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`));
        return;
      }

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');

        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              const choices = parsed.choices;
              if (choices && choices.length > 0) {
                const delta = choices[0].delta || {};
                const content = delta.content || delta.reasoning || '';
                if (content) {
                  if (!firstContentSeen) {
                    ttft = (performance.now() - t0) / 1000;
                    firstContentSeen = true;
                  }
                  outputTokens++;
                }
              }

              if (parsed.usage) {
                promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
              }
            } catch {
              // skip unparseable chunks
            }
          }
        }
      });

      res.on('end', () => finish());
      res.on('error', (err) => finish(err.message));
    });

    req.on('error', (err) => finish(err.message));
    req.write(body);
    req.end();
  });
}

// ── Request helper ─────────────────────────────────────────────────

async function sendRequest(
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  timeout: number,
  reasoningEffort: string | null,
): Promise<StreamResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const payload: Record<string, unknown> = {
    messages,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (model) payload.model = model;
  if (reasoningEffort) payload.reasoning_effort = reasoningEffort;

  return streamComplete(url, JSON.stringify(payload), timeout);
}

// ── Results ────────────────────────────────────────────────────────

interface StepResult {
  label: string;
  ttft: number;
  e2e: number;
  outputTokens: number;
  promptTokens: number | null;
  error: string | null;
  verdict: 'HIT' | 'MISS' | 'ERROR';
}

let CLASSIFY_THRESHOLD = 2.0;

function classify(ttft: number, error: string | null): 'HIT' | 'MISS' | 'ERROR' {
  if (error) return 'ERROR';
  return ttft < CLASSIFY_THRESHOLD ? 'HIT' : 'MISS';
}

function printTable(steps: StepResult[]): void {
  const header =
    `${'Step'.padEnd(38)} | ${'TTFT (s)'.padStart(9)} | ${'E2E (s)'.padStart(9)} | ${'Out'.padStart(5)} | ${'Prompt'.padStart(7)} | Verdict`;
  const sep =
    '-'.repeat(38) + '-+-' + '-'.repeat(9) + '-+-' + '-'.repeat(9) + '-+-' +
    '-'.repeat(5) + '-+-' + '-'.repeat(7) + '-+-' + '-'.repeat(7);
  console.log(`  ${header}`);
  console.log(`  ${sep}`);
  for (const s of steps) {
    const pt = s.promptTokens !== null ? String(s.promptTokens) : '—';
    const errTag = s.error ? ` ERR:${s.error.slice(0, 28)}` : '';
    console.log(
      `  ${s.label.padEnd(38)} | ${s.ttft.toFixed(3).padStart(9)} | ${s.e2e.toFixed(3).padStart(9)} | ` +
      `${String(s.outputTokens).padStart(5)} | ${pt.padStart(7)} | ${s.verdict}${errTag}`
    );
  }
  console.log();
}

function analyze(steps: StepResult[]): boolean {
  let pass = true;

  // Group steps by phase
  const groups = new Map<string, StepResult[]>();
  for (const s of steps) {
    const phase = s.label.split(' #')[0];
    if (!groups.has(phase)) groups.set(phase, []);
    groups.get(phase)!.push(s);
  }

  for (const [phase, phaseSteps] of groups) {
    if (phaseSteps.length < 2) continue;
    const [first, second] = phaseSteps;

    if (first.verdict !== 'MISS') {
      console.log(`  \u26A0 ${phase} #1 should be a MISS (fresh context) — got ${first.verdict}`);
      if (first.verdict === 'ERROR') console.log(`    (request failed: ${first.error})`);
      pass = false;
    }

    if (second.verdict !== 'HIT') {
      console.log(`  \u26A0 ${phase} #2 should be a HIT (same context) — got ${second.verdict}`);
      pass = false;
    }
  }

  // Cross-phase analysis
  const crossPD = groups.get('Proxy\u2192Direct');
  if (crossPD && crossPD.length >= 2) {
    const viaDirect = crossPD[1];
    if (viaDirect.verdict === 'HIT') {
      console.log('  \u2713 Cache warmed via proxy is visible via direct');
    } else {
      console.log('  \u26A0 Cache LOST on proxy\u2192direct switch');
      pass = false;
    }
  }

  const crossDP = groups.get('Direct\u2192Proxy');
  if (crossDP && crossDP.length >= 2) {
    const viaProxy = crossDP[1];
    if (viaProxy.verdict === 'HIT') {
      console.log('  \u2713 Cache warmed via direct is visible via proxy');
    } else {
      console.log('  \u26A0 Cache LOST on direct\u2192proxy switch \u2190 THIS IS THE BUG');
      pass = false;
    }
  }

  return pass;
}

// ── Phases ─────────────────────────────────────────────────────────

interface PhasePair {
  url: string;
  tag: string;
  reasoningEffort?: string | null;
}

interface PhaseDef {
  label: string;
  pairs: PhasePair[];
  seed: number;
}

async function runPhase(
  phase: PhaseDef,
  steps: StepResult[],
  model: string,
  contextTokens: number,
  maxTokens: number,
  timeout: number,
  defaultReasoningEffort: string | null,
): Promise<void> {
  const charCount = contextTokens * 4;
  const context = generateContext(phase.seed, charCount);
  const task = 'Summarize the key themes in the text above.';
  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: context + '\n\nTASK: ' + task },
  ];

  const reLabel = phase.pairs.some(p => p.reasoningEffort !== undefined)
    ? ' (effort varies)'
    : defaultReasoningEffort
      ? ` (effort=${defaultReasoningEffort})`
      : '';
  console.log(`  --- ${phase.label}${reLabel} (ctx seed ${phase.seed}) ---`);
  for (const pair of phase.pairs) {
    const idx = steps.filter(s => s.label.startsWith(phase.label)).length + 1;
    const effort = pair.reasoningEffort !== undefined ? pair.reasoningEffort : defaultReasoningEffort;
    const stepLabel = `${phase.label} #${idx} (${pair.tag})`;
    process.stdout.write(`  [${stepLabel}]...`);
    const r = await sendRequest(pair.url, model, messages, maxTokens, timeout, effort);
    const verdict = classify(r.ttft, r.error);
    steps.push({ label: stepLabel, ...r, verdict });
    const pt = r.promptTokens !== null ? `prompt=${r.promptTokens}` : '';
    const err = r.error ? ` ERROR: ${r.error}` : '';
    const effortTag = effort ? ` effort=${effort}` : '';
    process.stdout.write(` TTFT=${r.ttft.toFixed(3)}s${effortTag} -> ${verdict}${err ? ' ' + err : ''}\n`);
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseCli();

  CLASSIFY_THRESHOLD = cli.threshold;

  const MAX_TOKENS = 128;
  const TIMEOUT = 240;
  const CHAR_PER_TOKEN = 4;
  const charCount = cli.contextTokens * CHAR_PER_TOKEN;

  console.log();
  console.log('  ==============================================');
  console.log('   Cache-Hunter --- Cross-Path Cache Test');
  console.log('  ==============================================');
  console.log(`  Context:   ~${cli.contextTokens.toLocaleString()} tokens (${charCount.toLocaleString()} chars)`);
  console.log(`  Base seed: ${cli.seed}`);
  console.log(`  Model:     ${cli.model || '(none --- server default)'}`);
  console.log(`  Reasoning: ${cli.reasoningEffort || '(none)'}`);
  if (cli.compareReasoningEffort) {
    console.log(`  Compare:   reasoning_effort ${cli.reasoningEffort || 'none'} vs ${cli.compareReasoningEffort}`);
  }
  console.log(`  Direct:    ${cli.directUrl}`);
  console.log(`  Proxy:     ${cli.proxyUrl}`);
  console.log(`  Threshold: TTFT < ${cli.threshold}s -> HIT, >= ${cli.threshold}s -> MISS`);
  console.log();

  const steps: StepResult[] = [];
  const base = cli.seed;

  // Each phase gets its own seed so contexts are unique across phases.
  // Within a phase, the same context is sent twice:
  //   #1 should be MISS (cold cache)
  //   #2 should be HIT  (warm cache)

  const phases: PhaseDef[] = [
    {
      label: 'Direct',
      pairs: [
        { url: cli.directUrl, tag: 'cold' },
        { url: cli.directUrl, tag: 'warm' },
      ],
      seed: base + 0 * 9973,
    },
    {
      label: 'Proxy',
      pairs: [
        { url: cli.proxyUrl, tag: 'cold' },
        { url: cli.proxyUrl, tag: 'warm' },
      ],
      seed: base + 1 * 9973,
    },
    {
      label: 'Proxy\u2192Direct',
      pairs: [
        { url: cli.proxyUrl, tag: 'via proxy' },
        { url: cli.directUrl, tag: 'via direct' },
      ],
      seed: base + 2 * 9973,
    },
    {
      label: 'Direct\u2192Proxy',
      pairs: [
        { url: cli.directUrl, tag: 'via direct' },
        { url: cli.proxyUrl, tag: 'via proxy' },
      ],
      seed: base + 3 * 9973,
    },
  ];

  // Optional comparison phase: same context, different reasoning_effort
  if (cli.compareReasoningEffort && cli.reasoningEffort) {
    phases.push({
      label: 'EffortCompare',
      pairs: [
        { url: cli.directUrl, tag: `effort=${cli.reasoningEffort}`, reasoningEffort: cli.reasoningEffort },
        { url: cli.directUrl, tag: `effort=${cli.compareReasoningEffort}`, reasoningEffort: cli.compareReasoningEffort },
      ],
      seed: base + 4 * 9973,
    });
  }

  for (const phase of phases) {
    await runPhase(phase, steps, cli.model, cli.contextTokens, MAX_TOKENS, TIMEOUT, cli.reasoningEffort);
  }

  // Results
  console.log();
  console.log('  --- Results ---');
  printTable(steps);
  const pass = analyze(steps);
  console.log(`  ${pass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED --- see analysis above'}`);
  console.log();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
