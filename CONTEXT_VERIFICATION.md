# Context Coherence Verification

## Overview

This tool verifies that OpenFox sends context-coherent messages to vLLM by building a hash-based tree of conversation turns.

## The Problem

When using LLM APIs, each request must include the full conversation history. We need to verify that:
1. Turn N+1 includes all messages from Turn 1 to N
2. The context is built cumulatively and correctly
3. No messages are skipped or duplicated

## Solution: Hash-Based Context Tree

Each message is hashed, and each turn's context is the hash of all previous message hashes:

```
turn 1        turn 2        turn 3
------------------------------------
8b1a    d938    04e3

CUMULATIVE CHAIN:
8 b 1 a = 9bc7
            8 b 1 a d 9 3 8 = c1c0
                        8 b 1 a d 9 3 8 0 4 e 3 = 19d9
```

## How It Works

1. **Message Hash**: Each message content is hashed (MD5, first 4 chars)
2. **Cumulative Hash**: Each turn's context = hash(all previous message hashes)
3. **Validation**: Verify that turn N's context includes turns 1 to N-1

## Usage

```bash
# Demo with sample data
npm run demo

# Analyze actual logged conversation
npm run tree
```

## Example Output

```
HASH TREE VISUALIZATION:
================================================================================

turn 1        turn 2        turn 3        turn 4      
------------------------------------------------------
8b1a    d938    04e3    56d9

CUMULATIVE CHAIN:
8 b 1 a = 9bc7
            8 b 1 a d 9 3 8 = c1c0
                        8 b 1 a d 9 3 8 0 4 e 3 = 19d9
                                    8 b 1 a d 9 3 8 0 4 e 3 5 6 d 9 = a9e7

CONTEXT VALIDATION:
--------------------------------------------------------------------------------
✓ Turn 2: Context valid (includes T1-T1)
✓ Turn 3: Context valid (includes T1-T2)
✓ Turn 4: Context valid (includes T1-T3)

✓ All turns have valid context chains!
```

## Detecting Context Breaks

If a turn is missing context, it will be flagged:

```
✗ Turn 3: CONTEXT BREAK DETECTED!
```

This happens when:
- A message is skipped in the conversation history
- Messages are sent out of order
- The context is corrupted

## Technical Details

### Hash Algorithm
- **Algorithm**: MD5 (first 4 hex characters)
- **Input**: Message content (UTF-8)
- **Output**: 4-character hex string

### Cumulative Hash
- **Input**: Concatenation of all previous message hashes
- **Output**: Single hash representing the entire context

### Validation
- Compares expected cumulative hash with actual
- Flags any mismatches as context breaks

## Integration with Cache Hunter

The hash tree works with logged conversation data from `cache-hunter.db`:

```bash
# View hash tree for logged conversations
npm run tree
```

This reads the first logged conversation and builds the hash tree from the messages array.

## Future Enhancements

1. **Multi-conversation support**: Show hash trees for all logged conversations
2. **Visual diff**: Highlight exactly which messages are missing
3. **Performance metrics**: Correlate context breaks with latency spikes
4. **Export format**: Generate visual diagrams (Mermaid, GraphViz)
