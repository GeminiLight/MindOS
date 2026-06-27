import type {
  AgentRuntimeAdapterMetadata,
  AgentRuntimeHarnessCapabilities,
} from './registry.js';

export type AgentRuntimeOutputKind = AgentRuntimeHarnessCapabilities['output'][number];

const OUTPUT_KINDS: readonly AgentRuntimeOutputKind[] = [
  'text',
  'diff',
  'checkpoint',
  'artifact',
  'branch',
  'pr',
] as const;

const REVIEWABLE_OUTPUT_KINDS = new Set<AgentRuntimeOutputKind>([
  'diff',
  'checkpoint',
  'artifact',
  'branch',
  'pr',
]);

export function normalizeRuntimeOutputKinds(
  metadata?: Pick<AgentRuntimeAdapterMetadata, 'output'>,
  fallback: readonly AgentRuntimeOutputKind[] = ['text'],
): AgentRuntimeOutputKind[] {
  const kinds = new Set<AgentRuntimeOutputKind>();
  for (const kind of fallback) {
    if (isRuntimeOutputKind(kind)) kinds.add(kind);
  }
  for (const kind of metadata?.output?.kinds ?? []) {
    if (isRuntimeOutputKind(kind)) kinds.add(kind);
  }
  if (metadata?.output?.fileChanges) kinds.add('diff');
  if (metadata?.output?.artifacts) kinds.add('artifact');
  if (metadata?.output?.checkpoints) kinds.add('checkpoint');
  if (metadata?.output?.branches) kinds.add('branch');
  if (metadata?.output?.pullRequests) kinds.add('pr');
  kinds.add('text');
  return [...kinds].sort();
}

export function reviewableRuntimeOutputKinds(
  kinds: readonly AgentRuntimeOutputKind[],
): AgentRuntimeOutputKind[] {
  return kinds.filter((kind) => REVIEWABLE_OUTPUT_KINDS.has(kind));
}

export function hasDeclaredRuntimeOutputContract(
  metadata?: Pick<AgentRuntimeAdapterMetadata, 'output'>,
): boolean {
  return Boolean(metadata?.output?.kinds?.length);
}

function isRuntimeOutputKind(value: unknown): value is AgentRuntimeOutputKind {
  return OUTPUT_KINDS.includes(value as AgentRuntimeOutputKind);
}
