export type NativeRuntimeFailureKind = 'codex' | 'claude';

export type RuntimeFailureSummary = {
  reason: string;
  diagnosticHints?: string[];
};

const DEFAULT_MAX_REASON_LENGTH = 220;
const DEFAULT_MAX_HINT_LENGTH = 180;
const CODEX_REINSTALL_COMMAND = 'npm install -g @openai/codex@latest';

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function collapseWhitespace(text: string): string {
  return stripAnsi(text).replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function isStackNoiseLine(line: string): boolean {
  return /^at\s+/i.test(line)
    || /^file:\/\//i.test(line)
    || /^node:internal\//i.test(line)
    || /^Node\.js\s+v\d/i.test(line)
    || /^throw\s+new\s+Error/i.test(line)
    || /\bModuleJob\.run\b/i.test(line)
    || /\basyncRunEntryPointWithESMLoader\b/i.test(line);
}

function stripInlineStackFragments(text: string): string {
  return text
    .replace(/\s+at\s+(?:async\s+)?[\w.$<>\[\]-]+[\s\S]*$/i, '')
    .replace(/\s+Node\.js\s+v\d[\d.]*[\s\S]*$/i, '')
    .replace(/\bfile:\/\/\/\S+/gi, '')
    .replace(/\bnode:internal\/\S+/gi, '')
    .replace(/\bModuleJob\.run\b[\s\S]*$/i, '')
    .replace(/\basyncRunEntryPointWithESMLoader\b[\s\S]*$/i, '');
}

function knownRuntimeFailure(rawMessage: string, runtime?: NativeRuntimeFailureKind): RuntimeFailureSummary | null {
  const text = collapseWhitespace(rawMessage);

  if (
    (runtime === 'codex' || /\bcodex\b/i.test(text))
    && (
      /Missing optional dependency\s+@openai\/codex-[\w-]+/i.test(text)
      || /Reinstall Codex:\s*npm install -g @openai\/codex@latest/i.test(text)
    )
  ) {
    return {
      reason: `Codex is installed but incomplete. Reinstall Codex with "${CODEX_REINSTALL_COMMAND}", then restart MindOS.`,
      diagnosticHints: [
        `Run "${CODEX_REINSTALL_COMMAND}" in the same environment that starts MindOS.`,
      ],
    };
  }

  return null;
}

export function compactRuntimeFailureMessage(
  rawMessage: string,
  options: {
    runtime?: NativeRuntimeFailureKind;
    fallback?: string;
    maxLength?: number;
  } = {},
): string {
  const fallback = options.fallback ?? 'Runtime failed to start.';
  const text = stripAnsi(rawMessage).trim();
  if (!text) return fallback;

  const known = knownRuntimeFailure(text, options.runtime);
  if (known) return truncateText(known.reason, options.maxLength ?? DEFAULT_MAX_REASON_LENGTH);

  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const meaningful = lines.find((line) => !isStackNoiseLine(line)) ?? lines.join(' ');
  const compact = collapseWhitespace(stripInlineStackFragments(meaningful))
    .replace(/^Error:\s*/i, '')
    .replace(/^UnhandledPromiseRejection:\s*/i, '');

  return truncateText(compact || fallback, options.maxLength ?? DEFAULT_MAX_REASON_LENGTH);
}

export function summarizeRuntimeFailure(
  rawMessage: string,
  options: {
    runtime?: NativeRuntimeFailureKind;
    fallback?: string;
    maxReasonLength?: number;
  } = {},
): RuntimeFailureSummary {
  const known = knownRuntimeFailure(rawMessage, options.runtime);
  if (known) {
    return {
      reason: truncateText(known.reason, options.maxReasonLength ?? DEFAULT_MAX_REASON_LENGTH),
      diagnosticHints: known.diagnosticHints?.map((hint) => truncateText(hint, DEFAULT_MAX_HINT_LENGTH)),
    };
  }

  return {
    reason: compactRuntimeFailureMessage(rawMessage, {
      runtime: options.runtime,
      fallback: options.fallback,
      maxLength: options.maxReasonLength,
    }),
  };
}

export function compactRuntimeDiagnosticHints(
  hints: string[] | undefined,
  options: { runtime?: NativeRuntimeFailureKind; maxLength?: number } = {},
): string[] {
  if (!hints || hints.length === 0) return [];
  const compacted = hints
    .map((hint) => compactRuntimeFailureMessage(hint, {
      runtime: options.runtime,
      fallback: '',
      maxLength: options.maxLength ?? DEFAULT_MAX_HINT_LENGTH,
    }))
    .filter((hint) => hint.length > 0 && !isStackNoiseLine(hint));
  return Array.from(new Set(compacted));
}
