// ─── WeCom (企业微信) Adapter ─────────────────────────────────────────────────
// Implements IMAdapter using direct HTTP API (no external SDK needed).
// Supports two modes:
//   1. Webhook bot (simple, one-way, group chat only)
//   2. App bot (full, two-way, requires corp_id + corp_secret)

import type { IMAdapter, IMMessage, IMSendResult, WeComConfig } from '../types';

const SEND_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export class WeComAdapter implements IMAdapter {
  readonly platform = 'wecom' as const;

  private config: WeComConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: WeComConfig) {
    this.config = config;
  }

  async send(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    try {
      // Webhook mode: simple POST to webhook URL
      if (this.config.webhook_key) {
        return this.sendViaWebhook(message, signal);
      }

      // App mode: use access_token + message API
      if (this.config.corp_id && this.config.corp_secret) {
        return this.sendViaApp(message, signal);
      }

      return { ok: false, error: 'WeCom not configured: provide webhook_key or corp_id + corp_secret', timestamp: new Date().toISOString() };
    } catch (err) {
      return { ok: false, error: formatWeComError(err), timestamp: new Date().toISOString() };
    }
  }

  async verify(): Promise<boolean> {
    if (this.config.webhook_key) return true; // webhook mode has no verify endpoint

    if (this.config.corp_id && this.config.corp_secret) {
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
    const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${this.config.webhook_key}`;

    const body = message.format === 'markdown'
      ? { msgtype: 'markdown', markdown: { content: message.text } }
      : { msgtype: 'text', text: { content: message.text } };

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }, SEND_TIMEOUT_MS);

    const data = await res.json() as { errcode: number; errmsg: string };
    if (data.errcode !== 0) {
      return { ok: false, error: `WeCom webhook error: ${data.errmsg} (code ${data.errcode})`, timestamp: new Date().toISOString() };
    }
    return { ok: true, timestamp: new Date().toISOString() };
  }

  // ─── App Mode ───────────────────────────────────────────────────────────────

  private async sendViaApp(message: IMMessage, signal?: AbortSignal): Promise<IMSendResult> {
    const token = await this.ensureAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;

    const body: Record<string, unknown> = {
      touser: message.recipientId, // can also be toparty / totag
      agentid: 1000002, // default agent, user can override via config in future
      msgtype: message.format === 'markdown' ? 'markdown' : 'text',
    };

    if (message.format === 'markdown') {
      body.markdown = { content: message.text };
    } else {
      body.text = { content: message.text };
    }

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }, SEND_TIMEOUT_MS);

    const data = await res.json() as { errcode: number; errmsg: string; msgid?: string };
    if (data.errcode !== 0) {
      return { ok: false, error: `WeCom error: ${data.errmsg} (code ${data.errcode})`, timestamp: new Date().toISOString() };
    }
    return { ok: true, messageId: data.msgid ? String(data.msgid) : undefined, timestamp: new Date().toISOString() };
  }

  // ─── Token Management ───────────────────────────────────────────────────────

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.accessToken;
    }

    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.config.corp_id}&corpsecret=${this.config.corp_secret}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    const data = await res.json() as { errcode: number; errmsg: string; access_token?: string; expires_in?: number };

    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(`WeCom token error: ${data.errmsg} (code ${data.errcode})`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 7200) * 1000;
    return this.accessToken;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Merge external signal
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function formatWeComError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'AbortError') return 'Send cancelled';
  const msg = err.message;
  if (msg.includes('timed out') || msg.includes('abort')) return 'Send timed out (10s)';
  return `WeCom error: ${msg}`;
}
