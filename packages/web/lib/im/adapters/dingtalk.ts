// ─── DingTalk (钉钉) Adapter ──────────────────────────────────────────────────
// Implements IMAdapter using direct HTTP API (no external SDK needed).
// Supports two modes:
//   1. Webhook bot (simple, one-way, group chat only, HMAC-SHA256 signing)
//   2. App bot (full, two-way, requires client_id + client_secret)

import crypto from 'crypto';
import type { IMAdapter, IMMessage, IMSendResult, DingTalkConfig } from '../types';

const SEND_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class DingTalkAdapter implements IMAdapter {
  readonly platform = 'dingtalk' as const;

  private config: DingTalkConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: DingTalkConfig) {
    this.config = config;
  }

  async send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    try {
      if (this.config.webhook_url) {
        return await this.sendViaWebhook(message, signal);
      }

      if (this.config.client_id && this.config.client_secret) {
        return await this.sendViaApp(message, signal);
      }

      return { ok: false, error: 'DingTalk not configured: provide webhook_url or client_id + client_secret', timestamp: new Date().toISOString() };
    } catch (err) {
      return { ok: false, error: formatDingTalkError(err), timestamp: new Date().toISOString() };
    }
  }

  async verify(): Promise<boolean> {
    if (this.config.webhook_url) return true; // webhook mode has no verify

    if (this.config.client_id && this.config.client_secret) {
      try {
        await this.ensureAccessToken();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async dispose(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  // ─── Webhook Mode ───────────────────────────────────────────────────────────

  private async sendViaWebhook(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    let url = this.config.webhook_url!;

    // Sign the webhook URL if secret is configured
    if (this.config.webhook_secret) {
      const timestamp = Date.now();
      const stringToSign = `${timestamp}\n${this.config.webhook_secret}`;
      const sign = crypto.createHmac('sha256', this.config.webhook_secret).update(stringToSign).digest('base64');
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
    }

    // DingTalk webhook message types
    let body: Record<string, unknown>;
    if (message.format === 'markdown') {
      body = {
        msgtype: 'markdown',
        markdown: { title: 'MindOS', text: message.text },
      };
    } else {
      body = {
        msgtype: 'text',
        text: { content: message.text },
      };
    }

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }, SEND_TIMEOUT_MS);

    const data = await res.json() as { errcode: number; errmsg: string };
    if (data.errcode !== 0) {
      return { ok: false, error: `DingTalk webhook error: ${data.errmsg} (code ${data.errcode})`, timestamp: new Date().toISOString() };
    }
    return { ok: true, timestamp: new Date().toISOString() };
  }

  // ─── App Mode ───────────────────────────────────────────────────────────────

  private async sendViaApp(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    const token = await this.ensureAccessToken();

    // DingTalk uses a different API for app messages
    const url = `https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend`;

    const body: Record<string, unknown> = {
      robotCode: this.config.client_id,
      userIds: [message.recipientId],
      msgKey: message.format === 'markdown' ? 'sampleMarkdown' : 'sampleText',
      msgParam: message.format === 'markdown'
        ? JSON.stringify({ title: 'MindOS', text: message.text })
        : JSON.stringify({ content: message.text }),
    };

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(body),
      signal,
    }, SEND_TIMEOUT_MS);

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `DingTalk API error (${res.status}): ${text}`, timestamp: new Date().toISOString() };
    }

    const data = await res.json() as { processQueryKey?: string };
    return { ok: true, messageId: data.processQueryKey, timestamp: new Date().toISOString() };
  }

  // ─── Token Management ───────────────────────────────────────────────────────

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.accessToken;
    }

    const url = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appKey: this.config.client_id,
        appSecret: this.config.client_secret,
      }),
    }, SEND_TIMEOUT_MS);

    const data = await res.json() as { accessToken?: string; expireIn?: number; code?: string; message?: string };
    if (!data.accessToken) {
      throw new Error(`DingTalk token error: ${data.message ?? 'unknown'} (code ${data.code ?? 'unknown'})`);
    }

    this.accessToken = data.accessToken;
    this.tokenExpiresAt = Date.now() + (data.expireIn ?? 7200) * 1000;
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

function formatDingTalkError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError') return 'Send cancelled';
  const msg = err.message;
  if (msg.includes('timed out') || msg.includes('abort')) return 'DingTalk request timed out (10s)';
  return `DingTalk error: ${msg}`;
}
