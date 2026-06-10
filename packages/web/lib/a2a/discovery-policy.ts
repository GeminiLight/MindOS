const MAX_A2A_URL_LENGTH = 2048;

export type A2aDiscoveryPolicyReason =
  | 'invalid_url'
  | 'credentials_not_allowed'
  | 'private_network_not_allowed'
  | 'not_allowlisted';

export type A2aDiscoveryPolicyDecision =
  | { ok: true; url: string; origin: string }
  | { ok: false; reason: A2aDiscoveryPolicyReason; message: string };

export interface A2aDiscoveryPolicyOptions {
  allowedOrigins?: readonly string[];
  allowPrivateNetwork?: boolean;
}

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [ip4ToNumber('0.0.0.0'), ip4ToNumber('0.255.255.255')],
  [ip4ToNumber('10.0.0.0'), ip4ToNumber('10.255.255.255')],
  [ip4ToNumber('100.64.0.0'), ip4ToNumber('100.127.255.255')],
  [ip4ToNumber('127.0.0.0'), ip4ToNumber('127.255.255.255')],
  [ip4ToNumber('169.254.0.0'), ip4ToNumber('169.254.255.255')],
  [ip4ToNumber('172.16.0.0'), ip4ToNumber('172.31.255.255')],
  [ip4ToNumber('192.0.0.0'), ip4ToNumber('192.0.0.255')],
  [ip4ToNumber('192.168.0.0'), ip4ToNumber('192.168.255.255')],
  [ip4ToNumber('198.18.0.0'), ip4ToNumber('198.19.255.255')],
  [ip4ToNumber('224.0.0.0'), ip4ToNumber('255.255.255.255')],
];

function parseEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getDefaultA2aDiscoveryPolicyOptions(): A2aDiscoveryPolicyOptions {
  return {
    allowedOrigins: parseEnvList(process.env.MINDOS_A2A_ALLOWED_ORIGINS),
    allowPrivateNetwork: process.env.MINDOS_A2A_ALLOW_PRIVATE_NETWORK === '1',
  };
}

export function validateA2aDiscoveryUrl(
  input: unknown,
  options: A2aDiscoveryPolicyOptions = getDefaultA2aDiscoveryPolicyOptions(),
): A2aDiscoveryPolicyDecision {
  const decision = validateA2aHttpUrl(input, options);
  if (!decision.ok) return decision;
  const url = new URL(decision.url);
  if (url.search || url.hash) {
    return deny('invalid_url', 'A2A discovery base URL must not include query or hash fragments.');
  }
  return {
    ok: true,
    url: stripTrailingSlashes(url),
    origin: url.origin,
  };
}

export function validateA2aEndpointUrl(
  input: unknown,
  options: A2aDiscoveryPolicyOptions = getDefaultA2aDiscoveryPolicyOptions(),
): A2aDiscoveryPolicyDecision {
  return validateA2aHttpUrl(input, options);
}

function validateA2aHttpUrl(
  input: unknown,
  options: A2aDiscoveryPolicyOptions,
): A2aDiscoveryPolicyDecision {
  if (typeof input !== 'string') {
    return deny('invalid_url', 'A2A URL must be a string.');
  }

  const value = input.trim();
  if (!value || value.length > MAX_A2A_URL_LENGTH) {
    return deny('invalid_url', 'A2A URL is empty or too long.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return deny('invalid_url', 'A2A URL is malformed.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return deny('invalid_url', 'A2A URL must use http or https.');
  }
  if (!url.hostname) {
    return deny('invalid_url', 'A2A URL must include a hostname.');
  }
  if (url.username || url.password) {
    return deny('credentials_not_allowed', 'A2A URL must not include embedded credentials.');
  }

  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins ?? []);
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) {
    return deny('not_allowlisted', 'A2A URL is not in MINDOS_A2A_ALLOWED_ORIGINS.');
  }

  if (!options.allowPrivateNetwork && isPrivateNetworkHost(url.hostname)) {
    return deny(
      'private_network_not_allowed',
      'A2A blocks localhost and private-network hosts unless MINDOS_A2A_ALLOW_PRIVATE_NETWORK=1.',
    );
  }

  return {
    ok: true,
    url: url.toString(),
    origin: url.origin,
  };
}

export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.includes(':')) {
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  }

  const ip4 = parseIp4(host);
  if (ip4 === null) return false;
  return PRIVATE_IPV4_RANGES.some(([start, end]) => ip4 >= start && ip4 <= end);
}

function normalizeAllowedOrigins(origins: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const item of origins) {
    try {
      const url = new URL(item);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname && !url.username && !url.password) {
        normalized.push(url.origin);
      }
    } catch {
      // Invalid policy entries are ignored rather than widening access.
    }
  }
  return normalized;
}

function stripTrailingSlashes(url: URL): string {
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function deny(reason: A2aDiscoveryPolicyReason, message: string): A2aDiscoveryPolicyDecision {
  return { ok: false, reason, message };
}

function parseIp4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) + octet;
  }
  return result >>> 0;
}

function ip4ToNumber(value: string): number {
  const parsed = parseIp4(value);
  if (parsed === null) throw new Error(`Invalid IPv4 range: ${value}`);
  return parsed;
}
