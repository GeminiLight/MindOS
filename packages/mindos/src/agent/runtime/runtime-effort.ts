import { MINDOS_THINKING_LEVELS } from '../mindos-pi/thinking.js';

/**
 * Single source for reasoning-effort vocabularies and normalisation at the
 * request boundary.
 *
 * The three runtimes historically disagreed on effort handling: Pi clamps via
 * pi-ai, Claude silently drops unknown levels (`run.ts isClaudeReasoningEffort`),
 * and Codex forwards ANY `^[a-z][a-z0-9_-]{0,31}$` string straight to the
 * app-server — where an unsupported effort returns a JSON-RPC error that fails
 * the whole turn. `normalizeRuntimeEffort` gives every runtime one validated
 * vocabulary: a known level is passed through (case/whitespace folded), and an
 * unknown level falls back to the runtime default by OMITTING the effort, with a
 * caller-surfaceable note instead of a hard failure.
 *
 * This module is intentionally dependency-light (only the Pi thinking-level
 * constant) so `agent/turn/request.ts` — which is imported by web client code —
 * can consume it without pulling in runtime internals.
 */

export type RuntimeEffortKind = 'codex' | 'claude' | 'mindos' | 'acp';

/**
 * Codex app-server reasoning efforts. Static safety net derived from what the
 * app-server's own `model/list` enumerates in this repo's fixtures (low, medium,
 * high, xhigh, max, ultra — "ultra: maximum reasoning with delegation") plus the
 * gpt-5 family's `minimal`. Per-model truth stays in `supportedReasoningEfforts`;
 * this vocabulary only rejects values no Codex model has ever exposed (e.g.
 * "turbo"), which used to fail the whole turn with a JSON-RPC error.
 */
export const CODEX_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
/** Claude Code reasoning efforts (mirrors `run.ts isClaudeReasoningEffort`). */
export const CLAUDE_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
/** MindOS Pi thinking levels (mirrors `mindos-pi/thinking.ts`). */
export const MINDOS_THINKING_EFFORTS = MINDOS_THINKING_LEVELS;

export type RuntimeEffortVocabulary = readonly string[];

export function runtimeEffortVocabulary(kind: RuntimeEffortKind | string | undefined): RuntimeEffortVocabulary | null {
  switch (kind) {
    case 'codex': return CODEX_REASONING_EFFORTS;
    case 'claude': return CLAUDE_REASONING_EFFORTS;
    case 'mindos': return MINDOS_THINKING_EFFORTS;
    default: return null; // acp / unknown: no vocabulary, callers pass through
  }
}

export function runtimeEffortLabel(kind: RuntimeEffortKind | string | undefined): string {
  switch (kind) {
    case 'codex': return 'Codex';
    case 'claude': return 'Claude Code';
    case 'mindos': return 'MindOS';
    default: return 'this runtime';
  }
}

export type RuntimeEffortNormalization =
  /** A known level for this runtime, folded to lowercase. `requested` is set when folding changed the raw input. */
  | { effort: string; fellBack: false; requested?: string; note?: undefined }
  /** No effort requested (undefined/empty/non-string): the runtime uses its own default; not a fallback. */
  | { effort: undefined; fellBack: false }
  /** An unknown level: omit the effort so the runtime uses its default, and surface `note`. */
  | { effort: undefined; fellBack: true; requested: string; note: string };

/**
 * Normalises a requested reasoning effort against the runtime's vocabulary.
 * Returns the effort to forward (or `undefined` to omit), whether it fell back
 * to the runtime default, and a human-readable note for the fallback case.
 */
export function normalizeRuntimeEffort(
  kind: RuntimeEffortKind | string | undefined,
  level: unknown,
): RuntimeEffortNormalization {
  if (typeof level !== 'string') return { effort: undefined, fellBack: false };
  const trimmed = level.trim();
  if (!trimmed) return { effort: undefined, fellBack: false };

  const vocabulary = runtimeEffortVocabulary(kind);
  const normalized = trimmed.toLowerCase();
  if (!vocabulary) {
    // No vocabulary for this runtime (e.g. acp): pass the folded value through.
    return normalized === trimmed
      ? { effort: normalized, fellBack: false }
      : { effort: normalized, fellBack: false, requested: level };
  }
  if ((vocabulary as readonly string[]).includes(normalized)) {
    return normalized === trimmed
      ? { effort: normalized, fellBack: false }
      : { effort: normalized, fellBack: false, requested: level };
  }
  return {
    effort: undefined,
    fellBack: true,
    requested: level,
    note: `Reasoning effort "${trimmed}" is not supported by ${runtimeEffortLabel(kind)}; using its default instead.`,
  };
}
