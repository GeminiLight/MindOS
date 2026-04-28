// ─── WeChat Personal Adapter ──────────────────────────────────────────────────
// Implements IMAdapter using the official WeChat ClawBot iLink Bot HTTP JSON protocol.
// Reference: @tencent-weixin/openclaw-weixin (Tencent official plugin)
//
// Protocol:
//   - Base URL: https://ilinkai.weixin.qq.com
//   - Auth: Bearer {bot_token} (obtained via QR code scan)
//   - Send: POST /sendmessage
//   - Receive: Long polling GET /getupdates (Phase 2 — not implemented here)
//
// This adapter implements sending only (no message receiving).
// No external SDK required — uses native fetch.

import type { IMAdapter, IMMessage, IMSendResult, WeChatConfig } from '../types';

const WECHAT_API_BASE = 'https://ilinkai.weixin.qq.com';
const SEND_TIMEOUT_MS = 10_000;

export class WeChatAdapter implements IMAdapter {
  readonly platform = 'wechat' as const;

  private config: WeChatConfig;

  constructor(config: WeChatConfig) {
    this.config = config;
  }

  async send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    try {
      const url = `${WECHAT_API_BASE}/sendmessage`;

      const body = {
        chat_id: message.recipientId,
        text: message.text,
        // WeChat ClawBot only supports plain text for now
        // context_token would be needed for threaded replies (Phase 2)
      };

      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.bot_token}`,
        },
        body: JSON.stringify(body),
        signal,
      }, SEND_TIMEOUT_MS);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `WeChat API error (${res.status}): ${text || res.statusText}`, timestamp: new Date().toISOString() };
      }

      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      return {
        ok: true,
        messageId: data.message_id ? String(data.message_id) : undefined,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { ok: false, error: formatWeChatError(err), timestamp: new Date().toISOString() };
    }
  }

  async verify(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${WECHAT_API_BASE}/getme`, {
        headers: { 'Authorization': `Bearer ${this.config.bot_token}` },
      }, SEND_TIMEOUT_MS);
      return res.ok;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    // No persistent connections to clean up
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();

  return await new Promise<Response>((resolve, reject) => {
    if (init.signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out'));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      controller.abort();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    init.signal?.addEventListener('abort', onAbort, { once: true });

    fetch(url, { ...init, signal: controller.signal }).then(
      (response) => {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', onAbort);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function formatWeChatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError') return 'Send cancelled';
  const msg = err.message;
  if (msg.includes('timed out') || msg.includes('abort')) return 'WeChat request timed out (10s)';
  if (msg.includes('401') || msg.includes('Unauthorized')) return 'Invalid bot_token. Re-scan QR code to refresh.';
  return `WeChat error: ${msg}`;
}
