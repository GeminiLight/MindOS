const REDACTED = '[redacted]';
const MAX_REDACTION_DEPTH = 8;

const SENSITIVE_KEY_PATTERN = /(?:^|[_-])(api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|app[_-]?secret|bot[_-]?token|webhook[_-]?(?:url|key)|bearer)(?:$|[_-])/i;

const SENSITIVE_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(authorization\s*[:=]\s*bearer\s+)([^\s"',;]+)/gi, `$1${REDACTED}`],
  [/\b(api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|app[_-]?secret|bot[_-]?token|password|passwd|secret|token)\s*[:=]\s*(['"]?)([^'",\s&}]+)/gi, `$1=$2${REDACTED}`],
  [/([?&](?:access_token|refresh_token|api_key|key|token|auth|signature|sign|secret|client_secret)=)([^&#\s]+)/gi, `$1${REDACTED}`],
  [/\b(sk-ant-[A-Za-z0-9_-]{12,})\b/g, REDACTED],
  [/\b(sk-[A-Za-z0-9_-]{16,})\b/g, REDACTED],
  [/\b(ghp_[A-Za-z0-9_]{20,})\b/g, REDACTED],
  [/\b(github_pat_[A-Za-z0-9_]{20,})\b/g, REDACTED],
  [/\b(xox[baprs]-[A-Za-z0-9-]{16,})\b/g, REDACTED],
  [/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, REDACTED],
];

export function redactSensitiveText(text: string): string {
  return SENSITIVE_VALUE_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

export function redactSensitiveObject<T>(value: T): T {
  return redactSensitiveValue(value, 0, new WeakSet<object>()) as T;
}

function redactSensitiveValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_REDACTION_DEPTH) return '[max-depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key)
      ? REDACTED
      : redactSensitiveValue(nested, depth + 1, seen);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}
