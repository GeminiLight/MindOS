// ─── Slack Adapter ────────────────────────────────────────────────────────────
// Implements IMAdapter using @slack/web-api (dynamic import, lazy init).
// Uses Slack's mrkdwn format which is close to standard Markdown.

import type { IMAdapter, IMMessage, IMSendResult, SlackConfig } from '../types';

const SEND_TIMEOUT_MS = 10_000;

export class SlackAdapter implements IMAdapter {
  readonly platform = 'slack' as const;

  private client: any | null = null; // WebClient — typed as any to avoid top-level import
  private config: SlackConfig;
  private botInfoCache: { id: string; name: string } | null = null;

  constructor(config: SlackConfig) {
    this.config = config;
  }

  async send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    const client = await this.ensureClient();

    try {
      const opts: Record<string, unknown> = {
        channel: message.recipientId,
        text: message.text, // fallback text for notifications
      };

      // Slack uses mrkdwn (similar to markdown but with differences)
      if (message.format === 'markdown') {
        // Use blocks for rich formatting
        opts.blocks = [{ type: 'section', text: { type: 'mrkdwn', text: markdownToSlackMrkdwn(message.text) } }];
      }

      // Thread support
      if (message.threadId) {
        opts.thread_ts = message.threadId;
      }

      const result = await callWithTimeout(
        () => client.chat.postMessage(opts),
        SEND_TIMEOUT_MS,
        signal,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = result as any;
      return {
        ok: true,
        messageId: res?.ts ? String(res.ts) : undefined,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        error: formatSlackError(err),
        timestamp: new Date().toISOString(),
      };
    }
  }

  async verify(): Promise<boolean> {
    try {
      const client = await this.ensureClient();
      const result = await client.auth.test();
      if (result?.ok) {
        this.botInfoCache = { id: result.user_id ?? '', name: result.user ?? '' };
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  getBotInfo(): { id: string; name: string } | null {
    return this.botInfoCache;
  }

  async dispose(): Promise<void> {
    this.client = null;
    this.botInfoCache = null;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async ensureClient() {
    if (this.client) return this.client;
    this.client = await createSlackClient(this.config);
    return this.client;
  }
}

// ─── Slack Client Factory ─────────────────────────────────────────────────────

async function createSlackClient(config: SlackConfig) {
  try {
    const { WebClient } = await import('@slack/web-api');
    return new WebClient(config.bot_token);
  } catch (err) {
    if (err instanceof Error && (err.message.includes('Cannot find module') || err.message.includes('MODULE_NOT_FOUND'))) {
      throw new Error('@slack/web-api package not installed. Run: npm install @slack/web-api');
    }
    throw err;
  }
}

// ─── Markdown → Slack mrkdwn ──────────────────────────────────────────────────
// Slack mrkdwn differences from standard Markdown:
//   bold: *text* (not **text**)
//   italic: _text_ (same)
//   code: `text` (same)
//   link: <url|text> (not [text](url))
//   strikethrough: ~text~ (not ~~text~~)

function markdownToSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')           // **bold** → *bold*
    .replace(/~~(.+?)~~/g, '~$1~')               // ~~strike~~ → ~strike~
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>') // [text](url) → <url|text>
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*');        // # heading → *heading*
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

function formatSlackError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError') return 'Send cancelled';
  const msg = err.message;
  if (msg.includes('channel_not_found')) return 'Channel not found: check recipient_id';
  if (msg.includes('not_in_channel')) return 'Bot not in channel. Invite the bot first with /invite @botname';
  if (msg.includes('invalid_auth') || msg.includes('token_revoked')) return 'Invalid auth: check bot_token';
  if (msg.includes('ratelimited') || msg.includes('429')) return 'Rate limited by Slack, try again later';
  if (msg.includes('timed out')) return 'Send timed out (10s)';
  if (msg.includes('@slack/web-api package not installed')) return msg;
  return `Slack error: ${msg}`;
}
