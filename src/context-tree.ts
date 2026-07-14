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

export function hashContent(content: string | any[] | null | undefined): string {
  const str = typeof content === 'string' ? content : JSON.stringify(content) ?? ''
  return createHash('md5').update(str).digest('hex').substring(0, 4)
}

function serializeMessage(msg: Record<string, unknown>): string {
  return JSON.stringify(msg, Object.keys(msg).sort())
}

export function buildContextTree(messages: Array<Record<string, unknown>>): ContextNode[] {
  const tree: ContextNode[] = [];
  let cumulativeContext = '';

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const serialized = serializeMessage(message)
    const messageHash = hashContent(serialized);
    cumulativeContext += messageHash;
    const contextHash = hashContent(cumulativeContext);

    tree.push({
      turn: i + 1,
      role: (message.role as string) || '',
      content: typeof message.content === 'string' ? message.content : (message.content != null ? JSON.stringify(message.content) : ''),
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

export function validateContextChain(messages: Array<Record<string, unknown>>): ContextNode[] {
  return buildContextTree(messages);
}
