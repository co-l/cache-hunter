import { MessageGrid } from './hash-grid.js';

export function printValidationReport(
  grid: MessageGrid,
  completions: Array<{ messages: Array<{ role: string; content: string }>; tools?: any[] }>,
  toolsHashes: (string | null)[]
): void {
  const maxMessages = grid.rows;

  console.log();
  console.log('CONTEXT VALIDATION:');
  console.log('-'.repeat(80));

  const uniqueToolsHashes = [...new Set(toolsHashes.filter(h => h !== null))];
  if (uniqueToolsHashes.length > 1) {
    console.log(`\x1b[31m✗ TOOLS: Hash changed across calls!\x1b[0m`);
    const toolsVersions = new Map<string, number[]>();
    toolsHashes.forEach((hash, idx) => {
      if (hash) {
        if (!toolsVersions.has(hash)) {
          toolsVersions.set(hash, []);
        }
        toolsVersions.get(hash)!.push(idx);
      }
    });
    for (const [hash, indices] of toolsVersions) {
      console.log(`  Calls ${indices.join(', ')}: [${hash}]`);
      const firstCompletion = completions[indices[0]]
    const toolNames = firstCompletion?.tools?.map((t: any) => t.name || t.function?.name) ?? []
      console.log(`    Tools: ${toolNames.join(', ')}`);
    }
  } else {
    const callsWithTools = toolsHashes.map((h, i) => h ? i : -1).filter(i => i !== -1);
    const callsWithoutTools = toolsHashes.map((h, i) => h === null ? i : -1).filter(i => i !== -1);

    if (callsWithoutTools.length > 0) {
      console.log(`\x1b[31m✗ Tools present in calls [${callsWithTools.join(', ')}] but MISSING in calls [${callsWithoutTools.join(', ')}]\x1b[0m`);
    } else {
      console.log(`\x1b[32m✓ Tools consistent across all calls\x1b[0m`);
    }
  }

  let allValid = true;
  for (let msgIdx = 0; msgIdx < maxMessages; msgIdx++) {
    const hashes = grid.cells[msgIdx].filter(h => h !== null) as string[];
    if (hashes.length === 0) continue;

    const firstHash = hashes[0];
    const isConsistent = hashes.every(h => h === firstHash);

    if (!isConsistent) {
      allValid = false;
      console.log(`\x1b[31m✗ Row ${msgIdx}: HASH MISMATCH - content changed across calls!\x1b[0m`);

      const uniqueVersions = new Map<string, { callIdx: number; content: string }[]>();

      completions.forEach((comp, idx) => {
        const message = comp.messages[msgIdx];
        if (message) {
          const hash = grid.cells[msgIdx][idx]!;
          if (!uniqueVersions.has(hash)) {
            uniqueVersions.set(hash, []);
          }
          uniqueVersions.get(hash)!.push({
            callIdx: idx,
            content: message.content,
          });
        }
      });

      const versionEntries = [...uniqueVersions.entries()];
      if (versionEntries.length === 2) {
        const [hash1, versions1] = versionEntries[0];
        const [hash2, versions2] = versionEntries[1];
        if (!versions1[0] || !versions2[0]) continue;
        const content1 = versions1[0]?.content;
        const content2 = versions2[0]?.content;

        if (!content1 || !content2) continue;

        const str1 = typeof content1 === 'string' ? content1 : JSON.stringify(content1);
        const str2 = typeof content2 === 'string' ? content2 : JSON.stringify(content2);

        console.log(`\n  Version 1 [${hash1}] (${str1.length} chars):`);
        console.log(`  Version 2 [${hash2}] (${str2.length} chars):`);
        console.log('\n  Line-by-line diff:');

        const lines1 = str1.split('\n');
        const lines2 = str2.split('\n');
        const maxLines = Math.max(lines1.length, lines2.length);

        let diffCount = 0;
        for (let i = 0; i < maxLines && diffCount < 10; i++) {
          const line1 = lines1[i] || '';
          const line2 = lines2[i] || '';

          if (line1 !== line2) {
            diffCount++;
            console.log(`    Line ${i}:`);
            console.log(`      V1: ${line1.substring(0, 80)}`);
            console.log(`      V2: ${line2.substring(0, 80)}`);
          }
        }

        if (diffCount >= 10) {
          console.log('    ... (showing first 10 differences)');
        }
      } else {
        for (const [hash, versions] of uniqueVersions) {
          let content = typeof versions[0].content === 'string'
            ? versions[0].content.replace(/\n/g, '\\n')
            : JSON.stringify(versions[0].content);

          if (content.length > 200) {
            content = content.substring(0, 200) + '...';
          }

          console.log(`  [${hash}] ${content}`);
        }
      }
    }
  }

  if (allValid) {
    console.log('\x1b[32m✓ All messages have consistent hashes across API calls!\x1b[0m');
  }
}
