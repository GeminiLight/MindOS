// ─── Feishu (Lark) Adapter ────────────────────────────────────────────────────
// Implements IMAdapter using @larksuiteoapi/node-sdk (dynamic import, lazy init).
// Token refresh is handled automatically by the SDK.

import type { IMAdapter, IMMessage, IMSendResult, FeishuConfig } from '../types';

const SEND_TIMEOUT_MS = 10_000;

export class FeishuAdapter implements IMAdapter {
  readonly platform = 'feishu' as const;

  private client: any | null = null; // lark.Client — typed as any to avoid top-level import
  private config: FeishuConfig;
  private appName: string | null = null;

  constructor(config: FeishuConfig) {
    this.config = config;
  }

  async send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    const client = await this.ensureClient();
    const receiveIdType = inferReceiveIdType(message.recipientId);

    try {
      const { msgType, content } = buildFeishuContent(message);

      const result = await callWithTimeout(
        () => client.im.message.create({
          params: { receive_id_type: receiveIdType },
          data: {
            receive_id: message.recipientId,
            msg_type: msgType,
            content,
          },
        }),
        SEND_TIMEOUT_MS,
        signal,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = result as any;
      const messageId = res?.data?.message_id ?? res?.message_id;
      return {
        ok: true,
        messageId: messageId ? String(messageId) : undefined,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        error: formatFeishuError(err),
        timestamp: new Date().toISOString(),
      };
    }
  }

  async verify(): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      // Use bot info endpoint to verify credentials
      const res = await client.contact.user.get({
        params: { user_id_type: 'open_id' },
        path: { user_id: 'on_invalid_test' },
      });
      // A valid token returns an error about "user not found" rather than "auth failed"
      // If we get any response (even error), the token is valid
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Auth errors contain specific codes
      if (msg.includes('99991668') || msg.includes('99991664') || msg.includes('tenant_access_token')) {
        return false;
      }
      // Other errors (like "user not found") mean the token IS valid
      return true;
    }
  }

  getAppName(): string | null {
    return this.appName;
  }

  async dispose(): Promise<void> {
    this.client = null;
    this.appName = null;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async ensureClient() {
    if (this.client) return this.client;
    this.client = await createFeishuClient(this.config);
    return this.client;
  }
}

// ─── Feishu Client Factory ────────────────────────────────────────────────────

async function createFeishuClient(config: FeishuConfig) {
  try {
    const lark = await import('@larksuiteoapi/node-sdk');
    return new lark.Client({
      appId: config.app_id,
      appSecret: config.app_secret,
      appType: lark.AppType.SelfBuild,
    });
  } catch (err) {
    if (err instanceof Error && (err.message.includes('Cannot find module') || err.message.includes('MODULE_NOT_FOUND'))) {
      throw new Error('@larksuiteoapi/node-sdk package not installed. Run: npm install @larksuiteoapi/node-sdk');
    }
    throw err;
  }
}

// ─── Message Content Builder ──────────────────────────────────────────────────

function buildFeishuContent(message: IMMessage): { msgType: string; content: string } {
  if (message.format === 'markdown') {
    // Feishu doesn't have a native markdown msg type.
    // Use "post" (rich text) for formatted content, or "interactive" for cards.
    // Post is the closest to markdown and supports bold, links, code.
    return {
      msgType: 'post',
      content: JSON.stringify({
        zh_cn: {
          title: '',
          content: markdownToFeishuPost(message.text),
        },
      }),
    };
  }

  // Default: plain text
  return {
    msgType: 'text',
    content: JSON.stringify({ text: message.text }),
  };
}

/**
 * Convert standard markdown to Feishu Post (rich text) content array.
 * Feishu Post format: [[{tag, text, ...}, ...], ...]  — array of paragraphs, each is array of elements.
 * This is a best-effort conversion for common patterns.
 */
function markdownToFeishuPost(text: string): Array<Array<{ tag: string; text?: string; href?: string; style?: string[] }>> {
  const paragraphs: Array<Array<{ tag: string; text?: string; href?: string; style?: string[] }>> = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const elements: Array<{ tag: string; text?: string; href?: string; style?: string[] }> = [];

    // Heading → bold text
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      elements.push({ tag: 'text', text: headingMatch[1], style: ['bold'] });
      paragraphs.push(elements);
      continue;
    }

    // Empty line → empty paragraph
    if (!line.trim()) {
      paragraphs.push([{ tag: 'text', text: '' }]);
      continue;
    }

    // Process inline formatting within the line
    let remaining = line;
    while (remaining.length > 0) {
      // Bold **text**
      const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
      if (boldMatch) {
        elements.push({ tag: 'text', text: boldMatch[1], style: ['bold'] });
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // Inline code `text`
      const codeMatch = remaining.match(/^`([^`]+)`/);
      if (codeMatch) {
        elements.push({ tag: 'text', text: codeMatch[1], style: ['code'] });
        remaining = remaining.slice(codeMatch[0].length);
        continue;
      }

      // Link [text](url)
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        elements.push({ tag: 'a', text: linkMatch[1], href: linkMatch[2] });
        remaining = remaining.slice(linkMatch[0].length);
        continue;
      }

      // Plain text until next special char
      const plainMatch = remaining.match(/^[^*`[]+/);
      if (plainMatch) {
        elements.push({ tag: 'text', text: plainMatch[0] });
        remaining = remaining.slice(plainMatch[0].length);
        continue;
      }

      // Fallback: consume one character
      elements.push({ tag: 'text', text: remaining[0] });
      remaining = remaining.slice(1);
    }

    if (elements.length > 0) paragraphs.push(elements);
  }

  return paragraphs.length > 0 ? paragraphs : [[{ tag: 'text', text: text }]];
}

// ─── Receive ID Type Inference ────────────────────────────────────────────────

function inferReceiveIdType(recipientId: string): string {
  if (recipientId.startsWith('oc_')) return 'chat_id';
  if (recipientId.startsWith('ou_')) return 'open_id';
  if (recipientId.startsWith('on_')) return 'union_id';
  if (recipientId.includes('@')) return 'email';
  return 'chat_id'; // default
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(() => reject(new Error('Send timed out')), timeoutMs);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    fn().then(
      (val) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(val); },
      (err) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}

function formatFeishuError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError') return 'Send cancelled';
  const msg = err.message;
  if (msg.includes('99991668')) return 'Invalid credentials: check app_id and app_secret';
  if (msg.includes('99991403')) return 'Monthly API quota exhausted';
  if (msg.includes('99991400')) return `Request parameter error: ${msg}`;
  if (msg.includes('230001') || msg.includes('bot not in')) return 'Bot not in the chat. Add the bot to the group first.';
  if (msg.includes('timed out')) return 'Send timed out (10s)';
  if (msg.includes('@larksuiteoapi/node-sdk package not installed')) return msg;
  return `Feishu error: ${msg}`;
}
