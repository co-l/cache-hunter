import { createHash } from 'crypto';

export interface ContextNode {
  turn: number;
  role: string;
  content: string;
  messageHash: string;
  contextHash: string;
  isContextValid: boolean;
  hash: string;
  cumulativeChain: string[];
  cumulativeHash: string;
}

export function hashContent(content: string | any[]): string {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  return createHash('md5').update(str).digest('hex').substring(0, 4);
}

export function buildContextTree(messages: Array<{ role: string; content: string }>): ContextNode[] {
  const tree: ContextNode[] = [];
  let cumulativeContext = '';

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const messageHash = hashContent(message.content);
    cumulativeContext += messageHash;
    const contextHash = hashContent(cumulativeContext);

    tree.push({
      turn: i + 1,
      role: message.role,
      content: message.content,
      messageHash,
      contextHash,
      isContextValid: true,
      hash: messageHash,
      cumulativeChain: cumulativeContext.split('').slice(0, 4),
      cumulativeHash: contextHash,
    });
  }

  return tree;
}

export function validateContextChain(messages: Array<{ role: string; content: string }>): ContextNode[] {
  return buildContextTree(messages);
}
