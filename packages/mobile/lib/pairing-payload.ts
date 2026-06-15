export type PairingPayloadSource = 'url' | 'json' | 'deep-link';

export interface MobilePairingPayload {
  url: string;
  authToken?: string;
  source: PairingPayloadSource;
}

export type MobilePairingPayloadResult =
  | { ok: true; payload: MobilePairingPayload; tokenFromUrl: boolean }
  | { ok: false; message: string };

const TOKEN_KEYS = ['authToken', 'token', 'apiToken', 'accessToken'];
const URL_KEYS = ['url', 'serverUrl', 'baseUrl'];
const INVALID_MESSAGE = 'Scan a MindOS server URL or connection code.';

export function parseMobilePairingPayload(raw: string): MobilePairingPayloadResult {
  const input = raw.trim();
  if (!input) return { ok: false, message: INVALID_MESSAGE };

  const json = parseJsonPayload(input);
  if (json) return json;

  const deepLink = parseDeepLinkPayload(input);
  if (deepLink) return deepLink;

  return parseServerUrlPayload(input, 'url');
}

function parseJsonPayload(input: string): MobilePairingPayloadResult | null {
  if (!input.startsWith('{')) return null;

  try {
    const value = JSON.parse(input) as Record<string, unknown>;
    if (!value || typeof value !== 'object') {
      return { ok: false, message: INVALID_MESSAGE };
    }

    const rawUrl = firstString(value, URL_KEYS);
    if (!rawUrl) return { ok: false, message: INVALID_MESSAGE };

    const parsed = parseServerUrlPayload(rawUrl, 'json');
    if (!parsed.ok) return parsed;

    const explicitToken = firstString(value, TOKEN_KEYS);
    return {
      ok: true,
      tokenFromUrl: parsed.tokenFromUrl,
      payload: {
        ...parsed.payload,
        authToken: explicitToken?.trim() || parsed.payload.authToken,
        source: 'json',
      },
    };
  } catch {
    return { ok: false, message: INVALID_MESSAGE };
  }
}

function parseDeepLinkPayload(input: string): MobilePairingPayloadResult | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'mindos:') return null;
  const action = `${parsed.hostname}${parsed.pathname}`.replace(/^\/+/, '').toLowerCase();
  if (action !== 'connect' && action !== 'pair') {
    return { ok: false, message: INVALID_MESSAGE };
  }

  const rawUrl = firstSearchParam(parsed.searchParams, URL_KEYS);
  if (!rawUrl) return { ok: false, message: INVALID_MESSAGE };

  const parsedUrl = parseServerUrlPayload(rawUrl, 'deep-link');
  if (!parsedUrl.ok) return parsedUrl;

  const explicitToken = firstSearchParam(parsed.searchParams, TOKEN_KEYS);
  return {
    ok: true,
    tokenFromUrl: parsedUrl.tokenFromUrl,
    payload: {
      ...parsedUrl.payload,
      authToken: explicitToken?.trim() || parsedUrl.payload.authToken,
      source: 'deep-link',
    },
  };
}

function parseServerUrlPayload(
  rawUrl: string,
  source: PairingPayloadSource,
): MobilePairingPayloadResult {
  const parsed = normalizeServerUrlPayload(rawUrl);
  if (!parsed) return { ok: false, message: INVALID_MESSAGE };
  return {
    ok: true,
    tokenFromUrl: Boolean(parsed.authToken),
    payload: {
      url: parsed.url,
      authToken: parsed.authToken,
      source,
    },
  };
}

function normalizeServerUrlPayload(rawUrl: string): { url: string; authToken?: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const authToken = firstSearchParam(parsed.searchParams, TOKEN_KEYS)?.trim();
  parsed.search = '';
  parsed.hash = '';

  const cleanUrl = parsed.toString().replace(/\/+$/, '');
  return {
    url: cleanUrl,
    authToken: authToken || undefined,
  };
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function firstSearchParam(params: URLSearchParams, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params.get(key);
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}
