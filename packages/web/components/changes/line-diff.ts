// Sunk into the core package (Wave 3, spec-agent-core-consolidation).
// Edit packages/mindos/src/agent/tool/line-diff.ts instead of this file.
// Pure module (no node builtins) — safe for client components.
export {
  buildLineDiff,
  collapseDiffContext,
  type DiffLine,
  type DiffLineType,
  type DiffRow,
  type CollapsedGap,
} from '@geminilight/mindos/agent/tool/line-diff';
