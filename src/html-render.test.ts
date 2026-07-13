import { test, expect } from 'vitest';
import { buildMessageHashGrid, computeToolsHashes, buildHeaderLabels, buildTreeData } from './hash-grid.js';

test('buildMessageHashGrid produces correct grid dimensions', () => {
  const completions = [
    { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }] },
    { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }] }
  ];

  const { grid, hashMap } = buildMessageHashGrid(completions);

  expect(grid.rows).toBe(2);
  expect(grid.cols).toBe(2);
  expect(grid.cells[0][0]).toBe(grid.cells[0][1]);
  expect(grid.cells[1][0]).toBe(grid.cells[1][1]);
  expect(Object.keys(hashMap).length).toBe(2);
});

test('buildMessageHashGrid populates hashMap with content', () => {
  const completions = [
    { messages: [{ role: 'user', content: 'Unique content' }] }
  ];

  const { hashMap } = buildMessageHashGrid(completions);
  const hash = Object.keys(hashMap)[0];
  expect(hashMap[hash]).toBe('Unique content');
});

test('buildMessageHashGrid handles messages without content field', () => {
  const completions: any[] = [
    { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant' }] }
  ];

  const { grid, hashMap } = buildMessageHashGrid(completions);
  expect(grid.rows).toBe(2);
  expect(grid.cols).toBe(1);
  // Second message has no content, should produce a hash for empty string
  expect(grid.cells[1][0]).toBeTruthy();
  expect(typeof grid.cells[1][0]).toBe('string');
  expect(grid.cells[1][0]!.length).toBe(4);
});

test('computeToolsHashes returns null for empty tools', () => {
  const completions = [
    { messages: [], tools: undefined },
    { messages: [], tools: [] }
  ];

  const hashes = computeToolsHashes(completions);
  expect(hashes).toEqual([null, null]);
});

test('computeToolsHashes returns hash for tool definitions', () => {
  const completions = [
    { messages: [], tools: [{ type: 'function', function: { name: 'test' } }] }
  ];

  const hashes = computeToolsHashes(completions);
  expect(hashes[0]).toBeTruthy();
  expect(typeof hashes[0]).toBe('string');
  expect(hashes[0]!.length).toBe(4);
});

test('buildHeaderLabels formats labels correctly', () => {
  const completions = [
    { path: '/v1/chat/completions' },
    { path: '/v1/responses' }
  ];

  const labels = buildHeaderLabels(completions);
  expect(labels[0]).toBe('C  0');
  expect(labels[1]).toBe('R  1');
});

test('buildTreeData includes tool content in hash_map', () => {
  const completions = [
    {
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ type: 'function', function: { name: 'myTool' } }],
      path: '/v1/chat/completions'
    }
  ];

  const data = buildTreeData(completions);
  const toolHash = data.lines[2][0];
  expect(data.hash_map[toolHash]).toContain('myTool');
  expect(data.lines[0][0]).toBe('C  0');
});

test('buildTreeData produces correct line structure', () => {
  const completions = [
    {
      messages: [{ role: 'user', content: 'A' }, { role: 'assistant', content: 'B' }],
      tools: [{ type: 'function', function: { name: 'tool1' } }],
      path: '/v1/chat/completions'
    }
  ];

  const data = buildTreeData(completions);
  // lines: [header, effort_row, tools_row, msg0_row, msg1_row]
  expect(data.lines.length).toBe(5);
  expect(data.lines[0].length).toBe(1);
  expect(data.lines[1].length).toBe(1);
  expect(data.lines[2].length).toBe(1);
  expect(data.lines[3].length).toBe(1);
  expect(data.lines[4].length).toBe(1);
});
