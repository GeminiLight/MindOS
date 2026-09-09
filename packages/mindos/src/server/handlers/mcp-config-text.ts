/**
 * Text primitives shared by the TOML and YAML config walkers
 * (`mcp-config-toml.ts`, `mcp-config-yaml.ts`). Kept in a leaf module so the
 * two walkers depend on neither each other nor the `mcp-config-formats.ts`
 * facade that re-exports them.
 */

export function quotedConfigString(value: unknown): string {
  return JSON.stringify(String(value));
}

/** TOML bare keys and the YAML plain scalars we emit share one safe charset. */
export function bareOrQuotedKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : quotedConfigString(key);
}

export function trimTrailingBlankLines(lines: string[]): void {
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
}

export function collapseBlankLines(lines: string[]): string[] {
  const cleaned: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && cleaned.length > 0 && cleaned[cleaned.length - 1]?.trim() === '') continue;
    cleaned.push(line);
  }
  return cleaned;
}

/** Quoted string, boolean, inline array, number; anything else stays raw text. */
export function parseScalarLiteral(raw: string): unknown {
  if (!raw) return '';
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      return JSON.parse(raw.replace(/'/g, '"'));
    } catch {
      return raw;
    }
  }
  const numberValue = Number(raw);
  if (Number.isFinite(numberValue)) return numberValue;
  return raw;
}
