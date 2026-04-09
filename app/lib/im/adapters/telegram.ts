// ─── Telegram Adapter ─────────────────────────────────────────────────────────
// Implements IMAdapter using grammY (dynamic import, lazy init).

import type { IMAdapter, IMMessage, IMSendResult, TelegramConfig } from '../types';
import { markdownToTelegramV2 } from '../format';

const SEND_TIMEOUT_MS = 10_000;

export class TelegramAdapter implements IMAdapter {
  readonly platform = 'telegram' as const;

  private bot: Awaited<ReturnType<typeof createBot>> | null = null;
  private config: TelegramConfig;
  private botInfoCache: { id: number; username: string } | null = null;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  async send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    const bot = await this.ensureBot();
    const chatId = message.recipientId;
    const opts: Record<string, unknown> = {};

    if (message.threadId) {
      opts.message_thread_id = Number(message.threadId);
    }

    try {
      let result: { message_id: number };

      if (message.format === 'html') {
        result = await callWithTimeout(
          () => bot.api.sendMessage(chatId, message.text, { ...opts, parse_mode: 'HTML' }),
          SEND_TIMEOUT_MS, signal,
        );
      } else if (message.format === 'markdown') {
        // Try MarkdownV2 first, fallback to plain text on parse error
        try {
          const converted = markdownToTelegramV2(message.text);
          result = await callWithTimeout(
            () => bot.api.sendMessage(chatId, converted, { ...opts, parse_mode: 'MarkdownV2' }),
            SEND_TIMEOUT_MS, signal,
          );
        } catch (mdErr) {
          // If Telegram can't parse the markdown, fallback to plain text
          if (isParseError(mdErr)) {
            result = await callWithTimeout(
              () => bot.api.sendMessage(chatId, message.text, opts),
              SEND_TIMEOUT_MS, signal,
            );
          } else {
            throw mdErr;
          }
        }
      } else {
        result = await callWithTimeout(
          () => bot.api.sendMessage(chatId, message.text, opts),
          SEND_TIMEOUT_MS, signal,
        );
      }

      return {
        ok: true,
        messageId: String(result.message_id),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        error: formatTelegramError(err),
        timestamp: new Date().toISOString(),
      };
    }
  }

  async verify(): Promise<boolean> {
    try {
      const bot = await this.ensureBot();
      const me = await bot.api.getMe();
      this.botInfoCache = { id: me.id, username: me.username ?? '' };
      return true;
    } catch {
      return false;
    }
  }

  /** Get cached bot info (available after verify()). */
  getBotInfo(): { id: number; username: string } | null {
    return this.botInfoCache;
  }

  async dispose(): Promise<void> {
    this.bot = null;
    this.botInfoCache = null;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async ensureBot() {
    if (this.bot) return this.bot;
    this.bot = await createBot(this.config.bot_token);
    return this.bot;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createBot(token: string) {
  try {
    const { Bot } = await import('grammy');
    return new Bot(token);
  } catch (err) {
    if (err instanceof Error && (err.message.includes('Cannot find module') || err.message.includes('MODULE_NOT_FOUND'))) {
      throw new Error('grammy package not installed. Run: npm install grammy');
    }
    throw err;
  }
}

function callWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
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

function isParseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("can't parse entities") || msg.includes('bad request') && msg.includes('parse');
}

function formatTelegramError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError') return 'Send cancelled';
  const msg = err.message;
  if (msg.includes('Forbidden')) return 'Bot blocked by user or removed from group';
  if (msg.includes('chat not found') || msg.includes('404')) return `Chat not found: check recipient_id`;
  if (msg.includes('429') || msg.includes('Too Many Requests')) return 'Rate limited by Telegram, try again later';
  if (msg.includes('timed out')) return 'Send timed out (10s)';
  if (msg.includes('grammy package not installed')) return msg;
  return `Telegram error: ${msg}`;
}
