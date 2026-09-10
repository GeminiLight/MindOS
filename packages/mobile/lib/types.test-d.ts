/**
 * Compile-time contract for the Mobile type views over
 * `@geminilight/mindos/client-types`.
 *
 * Mobile keeps trimmed views of a few payload types (it renders a subset of
 * the descriptor fields), so the assertion for those is "every core value is
 * assignable to the mobile view" rather than strict equality; the timeline
 * and enum types must be the core types themselves. Checked by
 * `pnpm --filter @mindos/mobile typecheck`; vitest does not pick up
 * `.test-d.ts` (spec-client-types-and-sse-parsers).
 */
import type * as Core from '@geminilight/mindos/client-types';
import type * as Mobile from './types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Extends<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

type Assertions = [
  Expect<Equal<Mobile.AgentRuntimeKind, Core.AgentRuntimeKind>>,
  Expect<Equal<Mobile.AgentRuntimeStatus, Core.AgentRuntimeStatus>>,
  Expect<Equal<Mobile.AgentRuntimeAdapter, Core.AgentRuntimeAdapter>>,
  Expect<Extends<Core.AgentRuntimeDescriptor, Mobile.AgentRuntimeDescriptor>>,
  Expect<Extends<Core.AgentRuntimesPayload, Mobile.AgentRuntimesResponse>>,
  Expect<Equal<Mobile.AgentRunNodeKind, Core.AgentRunNodeKind>>,
  Expect<Equal<Mobile.AgentRunStatus, Core.AgentRunStatus>>,
  Expect<Equal<Mobile.AgentRunPermissionMode, Core.AgentRunPermissionMode>>,
  Expect<Equal<Mobile.AgentRunTimelineRecord, Core.AgentRunTimelineRecord>>,
  Expect<Equal<Mobile.AgentRunTimelineEventCategory, Core.AgentRunTimelineEventCategory>>,
  Expect<Equal<Mobile.AgentRunTimelineEventData, Core.AgentRunTimelineEventData>>,
  Expect<Equal<Mobile.AgentRunTimelineEvent, Core.AgentRunTimelineEvent>>,
  Expect<Equal<Mobile.AgentRunTimelinePart, Core.AgentRunTimelinePart>>,
  Expect<Equal<Mobile.PendingRuntimePermission, Core.PendingRuntimePermissionAction>>,
  Expect<Equal<Mobile.PendingAskUserQuestion, Core.PendingAskUserQuestionAction>>,
  Expect<Equal<Mobile.PendingAutomationApproval, Core.PendingAutomationApprovalAction>>,
  Expect<Equal<Mobile.PendingAgentActionsResponse, Core.PendingAgentActionsPayload>>,
  Expect<Equal<Mobile.PendingAgentActionEntry, Core.PendingAgentActionEntry>>,
];

export type { Assertions as ClientTypeAssertions };
