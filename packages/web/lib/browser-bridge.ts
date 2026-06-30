'use client';

const REQUEST_SOURCE = 'mindos-web';
const REQUEST_TARGET = 'mindos-browser-bridge';
const RESPONSE_SOURCE = 'mindos-browser-extension';
const DEFAULT_TIMEOUT_MS = 900;

export interface BrowserBridgeStatus {
  installed: true;
  name: string;
  version: string;
  configured: boolean;
  mindosUrl: string | null;
  transport: string;
}

export interface BrowserBridgeOpenResult {
  opened: true;
  tabId?: number;
  url: string;
  instruction?: string;
}

interface BrowserBridgeResponse {
  source: typeof RESPONSE_SOURCE;
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

type BrowserBridgeRequestType =
  | 'bridge.ping'
  | 'bridge.getStatus'
  | 'bridge.openUrlForUserCapture';

const BROWSER_SESSION_HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  'chat.deepseek.com',
  'deepseek.com',
  'kimi.moonshot.cn',
  'kimi.com',
  'chat.qwen.ai',
  'tongyi.aliyun.com',
  'qianwen.aliyun.com',
  'chatglm.cn',
  'z.ai',
  'chat.z.ai',
  'bigmodel.cn',
  'chat.minimax.io',
  'minimax.io',
  'chat.minimaxi.com',
  'hailuoai.com',
  'xiaohongshu.com',
  'www.xiaohongshu.com',
  'xhslink.com',
  'mp.weixin.qq.com',
];

export function requiresBrowserBridgeCapture(input: string): boolean {
  try {
    const host = new URL(input).hostname.toLowerCase().replace(/^www\./, '');
    return BROWSER_SESSION_HOSTS.some(candidate => host === candidate.replace(/^www\./, '') || host.endsWith(`.${candidate.replace(/^www\./, '')}`));
  } catch {
    return false;
  }
}

export async function getBrowserBridgeStatus(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BrowserBridgeStatus | null> {
  try {
    const data = await requestBrowserBridge('bridge.getStatus', undefined, timeoutMs);
    return isBrowserBridgeStatus(data) ? data : null;
  } catch {
    return null;
  }
}

export async function openUrlWithBrowserBridge(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BrowserBridgeOpenResult> {
  const data = await requestBrowserBridge('bridge.openUrlForUserCapture', { url }, timeoutMs);
  if (!isBrowserBridgeOpenResult(data)) {
    throw new Error('MindOS browser bridge returned an invalid open result');
  }
  return data;
}

async function requestBrowserBridge(
  type: BrowserBridgeRequestType,
  payload: unknown,
  timeoutMs: number,
): Promise<unknown> {
  if (typeof window === 'undefined') {
    throw new Error('MindOS browser bridge is only available in the browser');
  }

  const id = createRequestId();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      reject(new Error('MindOS browser bridge is not connected'));
    }, timeoutMs);

    function handleMessage(event: MessageEvent) {
      if (event.source !== window || !isBridgeResponse(event.data) || event.data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', handleMessage);
      if (event.data.ok) {
        resolve(event.data.data);
      } else {
        reject(new Error(event.data.error || 'MindOS browser bridge request failed'));
      }
    }

    window.addEventListener('message', handleMessage);
    window.postMessage({
      source: REQUEST_SOURCE,
      target: REQUEST_TARGET,
      id,
      type,
      ...(payload !== undefined ? { payload } : {}),
    }, window.location.origin);
  });
}

function createRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `mindos-bridge:${Date.now()}:${random}`;
}

function isBridgeResponse(value: unknown): value is BrowserBridgeResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<BrowserBridgeResponse>;
  return response.source === RESPONSE_SOURCE
    && typeof response.id === 'string'
    && typeof response.ok === 'boolean';
}

function isBrowserBridgeStatus(value: unknown): value is BrowserBridgeStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<BrowserBridgeStatus>;
  return status.installed === true
    && typeof status.name === 'string'
    && typeof status.version === 'string'
    && typeof status.configured === 'boolean'
    && (typeof status.mindosUrl === 'string' || status.mindosUrl === null)
    && typeof status.transport === 'string';
}

function isBrowserBridgeOpenResult(value: unknown): value is BrowserBridgeOpenResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<BrowserBridgeOpenResult>;
  return result.opened === true
    && typeof result.url === 'string'
    && (result.tabId === undefined || typeof result.tabId === 'number')
    && (result.instruction === undefined || typeof result.instruction === 'string');
}
