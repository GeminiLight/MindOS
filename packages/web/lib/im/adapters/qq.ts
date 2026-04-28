// ─── QQ Bot Adapter ───────────────────────────────────────────────────────────
// Implements IMAdapter using the official QQ Open Platform Bot API v2.
// Reference: https://bot.qq.com/wiki/develop/api-v2/
//
// Auth: AppID + AppSecret → access_token (7200s expiry)
// API Base: https://api.sgroup.qq.com
// Send: POST /v2/users/{openid}/messages (single chat)
//        POST /v2/groups/{group_openid}/messages (group chat)
//
// No external SDK required — uses native fetch.

import type { IMAdapter, IMMessage, IMSendResult, QQConfig } from '../types';

const QQ_API_BASE = 'https://api.sgroup.qq.com';
const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const SEND_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class QQAdapter implements IMAdapter {
  readonly platform = 'qq' as const;

  private config: QQConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: QQConfig) {
    this.config = config;
  }

  async send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    try {
      const token = await this.ensureAccessToken();
      const recipientId = message.recipientId;

      // Detect if this is a group or single chat by prefix convention
      // group_openid typically differs from user openid in format
      // Users can pass "group:XXXX" to explicitly target a group
      const isGroup = recipientId.startsWith('group:');
      const actualId = isGroup ? recipientId.slice(6) : recipientId;

      const endpoint = isGroup
        ? `${QQ_API_BASE}/v2/groups/${actualId}/messages`
        : `${QQ_API_BASE}/v2/users/${actualId}/messages`;

      // Build message body
      const body: Record<string, unknown> = { content: message.text, msg_type: 0 };

      // Use markdown if requested (msg_type: 2)
      if (message.format === 'markdown') {
        body.msg_type = 2;
        body.markdown = { content: message.text };
        delete body.content;
      }

      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${token}`,
        },
        body: JSON.stringify(body),
        signal,
      }, SEND_TIMEOUT_MS);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as Record<string, unknown>;
        const code = errData.code ?? res.status;
        const errMsg = errData.message ?? res.statusText;
        return { ok: false, error: `QQ API error (${code}): ${errMsg}`, timestamp: new Date().toISOString() };
      }

      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      return {
        ok: true,
        messageId: data.id ? String(data.id) : undefined,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { ok: false, error: formatQQError(err), timestamp: new Date().toISOString() };
    }
  }

  async verify(): Promise<boolean> {
    try {
      await this.ensureAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  // ─── Token Management ───────────────────────────────────────────────────────

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.accessToken;
    }

    const res = await fetchWithTimeout(QQ_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: this.config.app_id,
        clientSecret: this.config.app_secret,
      }),
    }, SEND_TIMEOUT_MS);

    if (!res.ok) {
      throw new Error(`QQ token request failed (${res.status}): ${res.statusText}`);
    }

    const data = await res.json() as { access_token?: string; expires_in?: string | number };
    if (!data.access_token) {
      throw new Error('QQ token response missing access_token');
    }

    this.accessToken = data.access_token;
    const expiresIn = typeof data.expires_in === 'string' ? parseInt(data.expires_in, 10) : (data.expires_in ?? 7200);
    this.tokenExpiresAt = Date.now() + expiresIn * 1000;
    return this.accessToken;
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

function formatQQError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError') return 'Send cancelled';
  const msg = err.message;
  if (msg.includes('timed out') || msg.includes('abort')) return 'QQ request timed out (10s)';
  if (msg.includes('22009')) return 'QQ message rate limit exceeded';
  if (msg.includes('401') || msg.includes('token')) return 'Invalid QQ credentials: check app_id and app_secret';
  return `QQ error: ${msg}`;
}
