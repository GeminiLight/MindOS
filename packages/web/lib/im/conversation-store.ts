import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IMPlatform } from '@/lib/im/types';
import type { Message } from '@/lib/types';

interface IMConversationRecord {
  sessionId: string;
  updatedAt: string;
  messages: Message[];
}

interface IMConversationStore {
  version: 1;
  conversations: Record<string, IMConversationRecord>;
}

const STORE_DIR = path.join(os.homedir(), '.mindos');
const STORE_PATH = path.join(STORE_DIR, 'im-conversations.json');
const MAX_MESSAGES = 12;

function getKey(platform: IMPlatform, chatId: string): string {
  return `${platform}:${chatId}`;
}

function createSessionId(platform: IMPlatform, chatId: string): string {
  return `${platform}-${chatId}-${Date.now()}`;
}

function readStore(): IMConversationStore {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return { version: 1, conversations: {} };
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && parsed.conversations && typeof parsed.conversations === 'object') {
      return parsed as IMConversationStore;
    }
  } catch {
    // ignore corrupt store
  }
  return { version: 1, conversations: {} };
}

function writeStore(store: IMConversationStore): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tmpPath = STORE_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, STORE_PATH);
}

export function getConversationHistory(platform: IMPlatform, chatId: string): { sessionId: string; messages: Message[] } {
  const store = readStore();
  const existing = store.conversations[getKey(platform, chatId)];
  if (existing) {
    return { sessionId: existing.sessionId, messages: existing.messages ?? [] };
  }
  return { sessionId: createSessionId(platform, chatId), messages: [] };
}

export function appendConversationTurn(params: {
  platform: IMPlatform;
  chatId: string;
  userMessage: Message;
  assistantMessage: Message;
}): { sessionId: string } {
  const store = readStore();
  const key = getKey(params.platform, params.chatId);
  const existing = store.conversations[key];
  const sessionId = existing?.sessionId ?? createSessionId(params.platform, params.chatId);
  const nextMessages = [...(existing?.messages ?? []), params.userMessage, params.assistantMessage].slice(-MAX_MESSAGES);

  store.conversations[key] = {
    sessionId,
    updatedAt: new Date().toISOString(),
    messages: nextMessages,
  };

  writeStore(store);
  return { sessionId };
}

export function clearConversation(platform: IMPlatform, chatId: string): void {
  const store = readStore();
  delete store.conversations[getKey(platform, chatId)];
  writeStore(store);
}
