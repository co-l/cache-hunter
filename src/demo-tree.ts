#!/usr/bin/env tsx
import { buildContextTree, hashContent } from './context-tree.js';

const messages = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi there' },
  { role: 'user', content: 'How are you?' },
  { role: 'assistant', content: 'I am good, thanks!' },
];

const tree = buildContextTree(messages);

console.log('HASH TREE VISUALIZATION (Demo)');
console.log('='.repeat(80));
console.log();

const header = tree.map((_, i) => `turn ${i + 1}`.padEnd(12)).join('  ');
console.log(header);
console.log('-'.repeat(header.length));

const hashes = tree.map(n => n.hash).join('    ');
console.log(hashes);
console.log();

console.log('CUMULATIVE CHAIN:');
let cumulative = '';
for (let i = 0; i < tree.length; i++) {
  const node = tree[i];
  cumulative += node.hash;
  const shortCumulative = cumulative.substring(0, cumulative.length).split('').join(' ');
  const prefix = ' '.repeat(i * 12);
  console.log(`${prefix}${shortCumulative} = ${node.cumulativeHash}`);
}

console.log();
console.log('CONTEXT VALIDATION:');
console.log('-'.repeat(80));

let allValid = true;
for (let i = 1; i < tree.length; i++) {
  const currNode = tree[i];
  const expectedChain = tree.slice(0, i + 1).map(n => n.hash).join('');
  const actualHash = hashContent(expectedChain);
  const isValid = currNode.cumulativeHash === actualHash;
  
  if (!isValid) {
    allValid = false;
    console.log(`✗ Turn ${currNode.turn}: CONTEXT BREAK DETECTED!`);
  } else {
    console.log(`✓ Turn ${currNode.turn}: Context valid (includes T1-T${i})`);
  }
}

if (allValid && tree.length > 1) {
  console.log('\n✓ All turns have valid context chains!');
}
