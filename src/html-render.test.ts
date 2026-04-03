import { test, expect } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateHtmlFile } from './hash-tree.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('visualizer.html renders hash values in grid cells', () => {
  const mockCompletions = [
    { messages: [{ role: 'user', content: 'Hello' }] },
    { messages: [{ role: 'user', content: 'Hello' }] }
  ];
  
  const mockGrid = {
    rows: 1,
    cols: 2,
    cells: [['abc123', 'abc123']]
  };
  
  const mockMessages = ['Hello'];
  const mockToolsHashes = ['def456', 'def456'];
  
  const outputPath = join(__dirname, '..', 'test-output.html');
  
  try {
    generateHtmlFile(mockCompletions, mockGrid, mockMessages, mockToolsHashes);
    const html = readFileSync(outputPath, 'utf-8');
    
    expect(html).toContain('abc123');
    expect(html).toContain('def456');
    expect(html).toContain('window.APP_DATA');
    
    const dataMatch = html.match(/window\.APP_DATA = (.*?);<\/script>/);
    expect(dataMatch).toBeTruthy();
    
    const data = JSON.parse(dataMatch![1]);
    expect(data.grid.cells[0][0].hash).toBe('abc123');
    expect(data.grid.cells[0][1].hash).toBe('abc123');
  } finally {
    try {
      unlinkSync(outputPath);
    } catch {}
  }
});
