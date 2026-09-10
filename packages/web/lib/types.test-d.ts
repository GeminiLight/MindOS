/**
 * Compile-time contract: the runtime / ACP / control-plane types that
 * `@/lib/types` exposes are the core package's own types, byte for byte.
 *
 * This file is checked by `pnpm --filter @mindos/web typecheck` (Web's
 * tsconfig excludes `__tests__`, so it lives next to the module it guards).
 * Vitest never executes it (its include pattern is `__tests__/**`).
 * If any assertion below fails to compile, a local declaration has crept
 * back into `packages/web/lib/types.ts` and drifted from
 * `@geminilight/mindos/client-types` (spec-client-types-and-sse-parsers).
 */
import type * as Core from '@geminilight/mindos/client-types';
import type * as Web from './types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Assertions = [
  Expect<Equal<Web.AgentRuntimeDescriptor, Core.AgentRuntimeDescriptor>>,
  Expect<Equal<Web.AgentRuntimeCapabilities, Core.AgentRuntimeCapabilities>>,
  Expect<Equal<Web.AgentRuntimeLifecycleSource, Core.AgentRuntimeLifecycleSource>>,
  Expect<Equal<Web.AgentRuntimeCatalogEntry, Core.AgentRuntimeCatalogEntry>>,
  Expect<Equal<Web.AgentRuntimeReadinessPayload, Core.AgentRuntimeReadinessPayload>>,
  Expect<Equal<Web.AgentRuntimeAdapterProjection, Core.AgentRuntimeAdapterProjection>>,
  Expect<Equal<Web.AgentRuntimeArtifactProjection, Core.AgentRuntimeArtifactProjection>>,
  Expect<Equal<Web.RuntimeSessionProjection, Core.RuntimeSessionProjection>>,
  Expect<Equal<Web.RuntimeControlPlaneSnapshot, Core.RuntimeControlPlaneSnapshot>>,
  Expect<Equal<Web.AcpToolCallFull, Core.AcpToolCallFull>>,
  Expect<Equal<Web.AcpSessionSnapshot, Core.AcpSessionSnapshot>>,
  Expect<Equal<Web.AcpPermissionEvent, Core.AcpPermissionEvent>>,
];

export type { Assertions as ClientTypeAssertions };
