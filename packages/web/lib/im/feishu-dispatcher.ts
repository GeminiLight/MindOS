import type { FeishuConfig, FeishuWebhookDispatchResult } from './types';
import { buildFeishuWebhookStatus, handleFeishuMessageReceiveEvent } from './webhook/feishu';

type FeishuHeaders = Record<string, string>;
type FeishuBody = Record<string, unknown>;
type FeishuDispatcher = {
  encryptKey?: string;
  register(handles: Record<string, (data: unknown) => unknown>): FeishuDispatcher;
  invoke(data: unknown, params?: { needCheck?: boolean }): Promise<unknown>;
};

type LarkSdkModule = typeof import('@larksuiteoapi/node-sdk');

let cachedSdk: LarkSdkModule | null = null;
let cachedDispatcher: { key: string; dispatcher: FeishuDispatcher } | null = null;

function buildDispatcherKey(config: FeishuConfig): string {
  return JSON.stringify({
    encryptKey: config.conversation?.encrypt_key ?? '',
    verificationToken: config.conversation?.verification_token ?? '',
  });
}

function buildPayload(body: FeishuBody, headers: FeishuHeaders): FeishuBody {
  return Object.assign(Object.create({ headers }), body);
}

function normalizeDispatcherBody(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  if (result == null) {
    return { ok: true };
  }
  return { ok: false, error: `Unexpected Feishu dispatcher result: ${String(result)}` };
}

async function getLarkSdk(): Promise<LarkSdkModule> {
  if (cachedSdk) return cachedSdk;
  cachedSdk = await import('@larksuiteoapi/node-sdk');
  return cachedSdk;
}

async function getDispatcher(config: FeishuConfig): Promise<FeishuDispatcher> {
  const key = buildDispatcherKey(config);
  if (cachedDispatcher?.key === key) {
    return cachedDispatcher.dispatcher;
  }

  const lark = await getLarkSdk();
  const dispatcher = new lark.EventDispatcher({
    encryptKey: config.conversation?.encrypt_key,
    verificationToken: config.conversation?.verification_token,
  }).register({
    'im.message.receive_v1': (event: unknown) => handleFeishuMessageReceiveEvent(event as import('./types').FeishuSdkMessageEvent),
  }) as FeishuDispatcher;

  cachedDispatcher = { key, dispatcher };
  return dispatcher;
}

function shouldHandleChallenge(body: FeishuBody): boolean {
  return typeof body.challenge === 'string'
    || body.type === 'url_verification'
    || typeof body.encrypt === 'string';
}

export async function dispatchFeishuWebhook(params: {
  config: FeishuConfig;
  body: FeishuBody;
  headers: FeishuHeaders;
}): Promise<FeishuWebhookDispatchResult> {
  const status = buildFeishuWebhookStatus(params.config);
  if (status.state !== 'ready') {
    return {
      status: 202,
      body: { ok: false, ignored: true, reason: status.lastError ?? 'Webhook is not ready' },
    };
  }

  const payload = buildPayload(params.body, params.headers);
  if (shouldHandleChallenge(params.body)) {
    const lark = await getLarkSdk();
    const { isChallenge, challenge } = lark.generateChallenge(payload, {
      encryptKey: params.config.conversation?.encrypt_key ?? '',
    });

    if (isChallenge) {
      return {
        status: 200,
        body: challenge,
      };
    }
  }

  const dispatcher = await getDispatcher(params.config);
  const result = await dispatcher.invoke(payload);

  if (typeof result === 'undefined') {
    return {
      status: 401,
      body: { ok: false, error: 'Invalid Feishu webhook signature or payload.' },
    };
  }

  const normalized = normalizeDispatcherBody(result);
  return {
    status: normalized.ok === false ? 500 : 202,
    body: normalized,
  };
}
