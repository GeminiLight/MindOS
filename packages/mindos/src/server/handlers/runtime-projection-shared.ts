import {
  isMindosPermissionMode,
  type MindosPermissionMode,
} from '../../agent/permission/index.js';
import type {
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeDescriptor,
} from '../../agent/runtime/registry.js';

/**
 * Helpers shared by the runtime projection handlers (adapter, artifact,
 * automation, permission, session, MCP) and the readiness aggregate. Each of
 * them used to carry its own copy of these, with three incompatible
 * `uniqSorted` signatures among them.
 */

/** One requirement line in a projection's `reasons` list. */
export type AgentRuntimeProjectionReason = {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
};

export function reason(
  id: string,
  status: AgentRuntimeCompatibilityRequirementStatus,
  owner: AgentRuntimeCompatibilityOwner,
  summary: string,
): AgentRuntimeProjectionReason {
  return { id, status, owner, summary };
}

/**
 * The `runtime-available` reason every projection starts with. The status and
 * owner logic is shared; each projection keeps its own wording for the two
 * outcomes (`${runtime.name} ${available}` / `${runtime.name} ${unavailable}`).
 */
export function runtimeAvailableReason(
  runtime: AgentRuntimeDescriptor,
  wording: { available: string; unavailable: string },
): AgentRuntimeProjectionReason {
  const available = runtime.status === 'available';
  return reason(
    'runtime-available',
    available ? 'satisfied' : 'missing',
    available ? 'mindos' : 'shared',
    `${runtime.name} ${available ? wording.available : wording.unavailable}`,
  );
}

/** Projection key for a descriptor: the stable runtime id, falling back to the descriptor id. */
export function runtimeKey(runtime: AgentRuntimeDescriptor): string {
  return runtime.runtimeId ?? runtime.id;
}

/** Trimmed, de-duplicated, sorted; empty and nullish entries are dropped. */
export function uniqSorted<T extends string>(values: Iterable<T | null | undefined>): T[] {
  const seen = new Set<T>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) seen.add(trimmed as T);
  }
  return [...seen].sort();
}

export function parsePermissionMode(value: string | null):
  | { permissionMode: MindosPermissionMode }
  | { error: string } {
  if (!value) return { permissionMode: 'ask' };
  if (isMindosPermissionMode(value)) return { permissionMode: value };
  return { error: `Unsupported permissionMode: ${value}` };
}

/** `?runtime=` matches either the projection's runtime id or its kind; blank means no filter. */
export function filterProjectionsByRuntime<T extends { runtimeId: string; runtimeKind: string }>(
  projections: T[],
  runtimeFilter: string | null | undefined,
): T[] {
  const filter = runtimeFilter?.trim();
  if (!filter) return projections;
  return projections.filter((projection) => projection.runtimeId === filter || projection.runtimeKind === filter);
}
