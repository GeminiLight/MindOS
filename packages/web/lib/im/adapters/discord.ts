// ─── Discord Adapter ──────────────────────────────────────────────────────────
// Implements IMAdapter using discord.js REST-only (no Gateway WebSocket).
// Only uses REST API for sending — no persistent connection needed.

import type { IMAdapter, IMMessage, IMSendResult, DiscordConfig } from '../types';

const SEND_TIMEOUT_MS = 10_000;

export class DiscordAdapter implements IMAdapter {
  readonly platform = 'discord' as const;

  private rest: any | null = null; // REST instance — typed as any to avoid top-level import
  private config: DiscordConfig;
  private botInfoCache: { id: string; username: string } | null = null;

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  async send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    const { rest, Routes } = await this.ensureRest();
    const channelId = message.recipientId;

    try {
      const body: Record<string, unknown> = { content: message.text };

      // Discord natively supports Markdown — no conversion needed
      // Thread support: if threadId is provided, send to that thread (which is a channel)
      const targetChannel = message.threadId ?? channelId;

      const result = await callWithTimeout(
        () => rest.post(Routes.channelMessages(targetChannel), { body }) as Promise<{ id: string }>,
        SEND_TIMEOUT_MS,
        signal,
      );

      return {
        ok: true,
        messageId: result?.id ? String(result.id) : undefined,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        error: formatDiscordError(err),
        timestamp: new Date().toISOString(),
      };
    }
  }

  async verify(): Promise<boolean> {
    try {
      const { rest, Routes } = await this.ensureRest();
      const me = await rest.get(Routes.user('@me')) as { id: string; username: string };
      this.botInfoCache = { id: me.id, username: me.username };
      return true;
    } catch {
      return false;
    }
  }

  getBotInfo(): { id: string; username: string } | null {
    return this.botInfoCache;
  }

  async dispose(): Promise<void> {
    this.rest = null;
    this.botInfoCache = null;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async ensureRest(): Promise<{ rest: any; Routes: any }> {
    const discordjs = await loadDiscordJS();
    if (!this.rest) {
      this.rest = new discordjs.REST({ version: '10' }).setToken(this.config.bot_token);
    }
    return { rest: this.rest, Routes: discordjs.Routes };
  }
}

// ─── Discord.js Loader ────────────────────────────────────────────────────────

let cachedDiscordJS: { REST: any; Routes: any } | null = null;

async function loadDiscordJS() {
  if (cachedDiscordJS) return cachedDiscordJS;
  try {
    const mod = await import('discord.js');
    cachedDiscordJS = { REST: mod.REST, Routes: mod.Routes };
    return cachedDiscordJS;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('Cannot find module') || err.message.includes('MODULE_NOT_FOUND'))) {
      throw new Error('discord.js package not installed. Run: npm install discord.js');
    }
    throw err;
  }
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

function formatDiscordError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError') return 'Send cancelled';
  const msg = err.message;
  // discord.js DiscordAPIError codes
  if (msg.includes('50001') || msg.includes('Missing Access')) return 'Missing access to channel. Check bot permissions.';
  if (msg.includes('50013') || msg.includes('Missing Permissions')) return 'Missing permissions to send messages in this channel.';
  if (msg.includes('10003') || msg.includes('Unknown Channel')) return 'Unknown channel: check recipient_id';
  if (msg.includes('40001') || msg.includes('Unauthorized')) return 'Unauthorized: check bot_token';
  if (msg.includes('timed out')) return 'Send timed out (10s)';
  if (msg.includes('discord.js package not installed')) return msg;
  // discord.js handles 429 automatically with built-in rate limit queue
  return `Discord error: ${msg}`;
}
