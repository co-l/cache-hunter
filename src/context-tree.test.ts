import { describe, it, expect } from 'vitest';
import { hashContent, buildContextTree, ContextNode } from './context-tree.js';

describe('Context Tree Analysis', () => {
  describe('hashContent', () => {
    it('should generate consistent hashes', () => {
      const content = 'test message';
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different content', () => {
      const hash1 = hashContent('message 1');
      const hash2 = hashContent('message 2');
      expect(hash1).not.toBe(hash2);
    });

    it('should return short hash (4 chars)', () => {
      const hash = hashContent('test');
      expect(hash.length).toBe(4);
    });

    it('should handle undefined content without throwing', () => {
      const hash = hashContent(undefined as any);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(4);
    });

    it('should handle null content without throwing', () => {
      const hash = hashContent(null as any);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(4);
    });
  });

  describe('buildContextTree', () => {
    it('should handle empty messages', () => {
      const messages: any[] = [];
      const tree = buildContextTree(messages);
      expect(tree).toEqual([]);
    });

    it('should build tree for single message', () => {
      const messages = [
        { role: 'user', content: 'Hello' }
      ];
      const tree = buildContextTree(messages);
      expect(tree.length).toBe(1);
      expect(tree[0].turn).toBe(1);
      expect(tree[0].messageHash).toBeDefined();
    });

    it('should differentiate messages by role', () => {
      const messages1 = [{ role: 'user', content: 'Hello' }];
      const messages2 = [{ role: 'assistant', content: 'Hello' }];
      const tree1 = buildContextTree(messages1);
      const tree2 = buildContextTree(messages2);
      // Same content, different role -> different hashes
      expect(tree1[0].messageHash).not.toBe(tree2[0].messageHash);
    });

    it('should build cumulative context hash for multiple messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' }
      ];
      const tree = buildContextTree(messages);
      expect(tree.length).toBe(2);
      
      // Turn 1: contextHash = hash(messageHash)
      expect(tree[0].contextHash).toBeDefined();
      // Turn 2: contextHash = hash(messageHash1 + messageHash2) - different from turn 1
      expect(tree[1].contextHash).not.toBe(tree[0].contextHash);
    });

    it('should detect context breaks', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'How are you?' }
      ];
      const tree = buildContextTree(messages);
      
      // Each turn should have unique cumulative context
      expect(tree[0].contextHash).not.toBe(tree[1].contextHash);
      expect(tree[1].contextHash).not.toBe(tree[2].contextHash);
      
      // Context should accumulate (each turn includes all previous)
      expect(tree[2].contextHash).not.toBe(tree[1].contextHash);
    });

    it('should extract role and content from full message objects', () => {
      const messages = [
        { role: 'user', content: 'Hello', name: 'Alice', extra_field: true }
      ];
      const tree = buildContextTree(messages);
      expect(tree[0].role).toBe('user');
      expect(tree[0].content).toBe('Hello');
    });
  });
});
