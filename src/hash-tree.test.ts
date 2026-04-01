import { describe, it, expect } from 'vitest';
import { buildMessageHashGrid, MessageGrid } from './hash-tree.js';

describe('Message Hash Grid', () => {
  it('should build grid showing message presence across completions', () => {
    const completions = [
      { messages: [{ role: 'user', content: 'Hello' }] },
      { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }] },
      { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }, { role: 'user', content: 'How?' }] },
    ];

    const grid = buildMessageHashGrid(completions);
    
    expect(grid.rows).toBe(3);
    expect(grid.cols).toBe(3);
    
    const msg0Hash = grid.cells[0][0];
    expect(grid.cells[0][0]).toBe(msg0Hash);
    expect(grid.cells[0][1]).toBe(msg0Hash);
    expect(grid.cells[0][2]).toBe(msg0Hash);
    
    const msg1Hash = grid.cells[1][1];
    expect(grid.cells[1][1]).toBe(msg1Hash);
    expect(grid.cells[1][2]).toBe(msg1Hash);
    
    expect(grid.cells[2][2]).toBeDefined();
  });

  it('should detect hash mismatches', () => {
    const completions = [
      { messages: [{ role: 'user', content: 'Hello' }] },
      { messages: [{ role: 'user', content: 'Hello World' }, { role: 'assistant', content: 'Hi' }] },
    ];

    const grid = buildMessageHashGrid(completions);
    expect(grid.cells[0][0]).not.toBe(grid.cells[0][1]);
  });
});
