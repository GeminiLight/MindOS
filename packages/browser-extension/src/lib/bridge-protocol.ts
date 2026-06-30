export const MINDOS_PAGE_BRIDGE_SOURCE = 'mindos-web';
export const MINDOS_PAGE_BRIDGE_TARGET = 'mindos-browser-bridge';
export const MINDOS_EXTENSION_BRIDGE_SOURCE = 'mindos-browser-extension';
export const MINDOS_CONTENT_BRIDGE_SOURCE = 'mindos-content-bridge';

export const MINDOS_BRIDGE_READY_TYPE = 'bridge.ready';
export const MINDOS_BRIDGE_REQUEST_TYPES = [
  'bridge.ping',
  'bridge.getStatus',
  'bridge.openUrlForUserCapture',
] as const;

export type MindosBridgeRequestType = typeof MINDOS_BRIDGE_REQUEST_TYPES[number];

export interface MindosPageBridgeRequest {
  source: typeof MINDOS_PAGE_BRIDGE_SOURCE;
  target: typeof MINDOS_PAGE_BRIDGE_TARGET;
  id: string;
  type: MindosBridgeRequestType;
  payload?: unknown;
}

export interface MindosExtensionBridgeRequest {
  source: typeof MINDOS_CONTENT_BRIDGE_SOURCE;
  id: string;
  type: MindosBridgeRequestType;
  payload?: unknown;
}

export interface MindosBridgeResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export function isMindosPageBridgeRequest(value: unknown): value is MindosPageBridgeRequest {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Partial<MindosPageBridgeRequest>;
  return msg.source === MINDOS_PAGE_BRIDGE_SOURCE
    && msg.target === MINDOS_PAGE_BRIDGE_TARGET
    && typeof msg.id === 'string'
    && msg.id.length > 0
    && isMindosBridgeRequestType(msg.type);
}

export function isMindosExtensionBridgeRequest(value: unknown): value is MindosExtensionBridgeRequest {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Partial<MindosExtensionBridgeRequest>;
  return msg.source === MINDOS_CONTENT_BRIDGE_SOURCE
    && typeof msg.id === 'string'
    && msg.id.length > 0
    && isMindosBridgeRequestType(msg.type);
}

export function isMindosBridgeRequestType(value: unknown): value is MindosBridgeRequestType {
  return typeof value === 'string'
    && (MINDOS_BRIDGE_REQUEST_TYPES as readonly string[]).includes(value);
}

export function isAllowedMindosPageUrl(input: string | undefined): boolean {
  if (!input) return false;
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'localhost'
      || host === '127.0.0.1'
      || host === '[::1]'
      || host === '::1';
  } catch {
    return false;
  }
}

export function bridgeOpenUrlFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const url = (payload as { url?: unknown }).url;
  if (typeof url !== 'string') return null;
  return isOpenableBrowserUrl(url) ? url : null;
}

export function isOpenableBrowserUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
