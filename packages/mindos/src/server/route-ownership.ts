export type MindosWebApiRouteOwner =
  | 'product-owned'
  | 'host-owned'
  | 'optional-capability';

export type MindosWebApiRouteAdapter =
  | 'mindos-app'
  | 'stream'
  | 'host'
  | 'optional-capability';

export type MindosWebApiRouteRisk = 'low' | 'medium' | 'high';

export type MindosWebApiRouteOwnership = {
  path: string;
  webRouteFile: string;
  owner: MindosWebApiRouteOwner;
  adapter: MindosWebApiRouteAdapter;
  phase: string;
  risk: MindosWebApiRouteRisk;
  residualRisk: string;
};

function route(
  path: string,
  owner: MindosWebApiRouteOwner,
  adapter: MindosWebApiRouteAdapter,
  phase: string,
  risk: MindosWebApiRouteRisk,
  residualRisk: string,
): MindosWebApiRouteOwnership {
  return {
    path,
    webRouteFile: `packages/web/app${path}/route.ts`,
    owner,
    adapter,
    phase,
    risk,
    residualRisk,
  };
}

/** Routes served by the shared Hono route table via `delegateToMindos`; the Web file is a one-line delegation. */
const delegated = (path: string, risk: MindosWebApiRouteRisk = 'low') =>
  route(
    path,
    'product-owned',
    'mindos-app',
    'Phase 7: unified Hono route table delegation',
    risk,
    'Served by the shared route table through handleMindosRequest; the Next file only injects host services.',
  );

const optional = (
  path: string,
  phase: string,
  risk: MindosWebApiRouteRisk,
  residualRisk: string,
) => route(path, 'optional-capability', 'optional-capability', phase, risk, residualRisk);

const host = (path: string, residualRisk: string, risk: MindosWebApiRouteRisk = 'medium') =>
  route(path, 'host-owned', 'host', 'Host-owned', risk, residualRisk);

export const MINDOS_WEB_API_ROUTE_OWNERSHIP: MindosWebApiRouteOwnership[] = [
  delegated('/api/a2a/agents', 'medium'),
  delegated('/api/a2a/delegations', 'medium'),
  delegated('/api/a2a/discover', 'medium'),
  delegated('/api/a2a', 'medium'),
  delegated('/api/acp/config', 'high'),
  delegated('/api/acp/detect', 'medium'),
  delegated('/api/acp/install', 'high'),
  delegated('/api/acp/registry', 'medium'),
  delegated('/api/acp/session', 'high'),
  delegated('/api/agent-activity'),
  delegated('/api/agent/pending-actions', 'high'),
  delegated('/api/agent/automation-approval', 'high'),
  delegated('/api/agent-runs', 'medium'),
  delegated('/api/agent-run-capsules', 'medium'),
  delegated('/api/agent-run-capsules/[capsuleId]/recovery', 'high'),
  host('/api/agent-runs/cancel', 'Agent run cancellation dispatches to Web host in-process cancellation handlers and must stay host-owned until Product Server owns run execution control.', 'high'),
  host('/api/agent-runs/reattach', 'Agent run reattach streams replay Web host in-memory ledger events and must stay host-owned until Product Server owns run persistence and event fanout.', 'medium'),
  host('/api/assistant-runs', 'Assistant run execution currently normalizes assistant requests and delegates into the Web Ask runner; Product Server owns the profile registry only until Runtime Context and Schedule persistence are promoted.', 'medium'),
  delegated('/api/assistants', 'medium'),
  delegated('/api/agent-runtimes', 'medium'),
  host('/api/agent-runtimes/external-sessions', 'External runtime session import is Web-owned because it reads native CLI transcript files from host-specific locations; Product Server should own it only after transcript import services and capability limits are promoted.', 'medium'),
  delegated('/api/agent-runtimes/mcp-projections', 'medium'),
  delegated('/api/agent-runtimes/adapter-projections', 'medium'),
  delegated('/api/agent-runtimes/permission-projections', 'medium'),
  delegated('/api/agent-runtimes/session-projections', 'medium'),
  delegated('/api/agent-runtimes/artifact-projections', 'medium'),
  delegated('/api/agent-runtimes/automation-projections', 'medium'),
  delegated('/api/agent-runtimes/control-plane', 'high'),
  delegated('/api/agent-runtimes/readiness', 'medium'),
  delegated('/api/agent-runtimes/extensions', 'high'),
  delegated('/api/agent-runtimes/extensions/preflight', 'high'),
  delegated('/api/agent-runtimes/extensions/install', 'high'),
  delegated('/api/agent-runtimes/codex/models', 'medium'),
  delegated('/api/agent-runtimes/codex/threads', 'medium'),
  delegated('/api/agent-runtimes/codex/threads/[threadId]', 'medium'),
  delegated('/api/agent-runtimes/codex/threads/[threadId]/archive', 'medium'),
  delegated('/api/agent-runtimes/codex/threads/[threadId]/fork', 'medium'),
  delegated('/api/agent-runtimes/codex/threads/[threadId]/unarchive', 'medium'),
  delegated('/api/agents/copy-skill', 'high'),
  delegated('/api/agents/custom/detect', 'medium'),
  delegated('/api/agents/custom', 'high'),
  delegated('/api/agent-capabilities', 'medium'),
  delegated('/api/agent/sessions'),
  route('/api/agent/sessions/[sessionId]/turns', 'product-owned', 'stream', 'Phase 6: generated client and stream adapter', 'high', 'Canonical session/turn route for agent execution.'),
  delegated('/api/agent/runtime-permission', 'high'),
  host('/api/agent/runtime-permission/request', 'Native runtime permission requests are per active Web agent turn and use in-memory bridge state owned by the host Chat Panel.', 'high'),
  delegated('/api/agent/user-question', 'high'),
  host('/api/agent/user-question/request', 'Native runtime user-question requests are per active Web agent turn and use in-memory bridge state owned by the host Chat Panel.', 'high'),
  host('/api/auth', 'Auth cookie/session handling is host-specific today; Product Server will need an auth context adapter before direct HTTP exposure.', 'high'),
  delegated('/api/backlinks'),
  delegated('/api/bootstrap'),
  delegated('/api/changes'),
  delegated('/api/channels/verify', 'medium'),
  delegated('/api/connections', 'high'),
  delegated('/api/studio/automation-events', 'high'),
  delegated('/api/connect'),
  host('/api/echo', 'Echo save/list APIs currently use Web-owned echo-store helpers and local content-change logging; Product Server should own this once Echo persistence is promoted.', 'medium'),
  host('/api/echo/cards', 'Echo card generation currently reads Web agent sessions, schedule state, and Web-local LM task runners; Product Server should own it once Echo card persistence and AI task orchestration are promoted.', 'medium'),
  host('/api/echo/imprints', 'Echo Imprint generation currently owns Web-local schedule state, agent-session reads, and LM task execution; Product Server should own it once Echo generation persistence and AI task orchestration are promoted.', 'medium'),
  host('/api/echo/corrections', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/inquiries', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/inquiries/methods', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/learning', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/longitudinal', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/method-checks', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/method-comparisons', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/research', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/research/export', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/research/invitations', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/research/reviewers', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/echo/transfer', 'Echo learning / coevolution research APIs read and write Web-owned knowledge stores through the Web adapter; Product Server should own them once the learning loop persistence is promoted.', 'medium'),
  host('/api/study/longitudinal/[id]', 'Scoped study participant / reviewer endpoints authenticate their own invitation tokens outside the owner bearer and are served only by the Next host today; revisit ownership together with the Echo research promotion.', 'high'),
  host('/api/study/longitudinal/[id]/session', 'Scoped study participant / reviewer endpoints authenticate their own invitation tokens outside the owner bearer and are served only by the Next host today; revisit ownership together with the Echo research promotion.', 'high'),
  host('/api/study/participate/[id]', 'Scoped study participant / reviewer endpoints authenticate their own invitation tokens outside the owner bearer and are served only by the Next host today; revisit ownership together with the Echo research promotion.', 'high'),
  host('/api/study/participate/[id]/session', 'Scoped study participant / reviewer endpoints authenticate their own invitation tokens outside the owner bearer and are served only by the Next host today; revisit ownership together with the Echo research promotion.', 'high'),
  host('/api/study/review/[id]', 'Scoped study participant / reviewer endpoints authenticate their own invitation tokens outside the owner bearer and are served only by the Next host today; revisit ownership together with the Echo research promotion.', 'high'),
  host('/api/study/review/[id]/session', 'Scoped study participant / reviewer endpoints authenticate their own invitation tokens outside the owner bearer and are served only by the Next host today; revisit ownership together with the Echo research promotion.', 'high'),
  delegated('/api/embedding', 'medium'),
  route('/api/events', 'product-owned', 'stream', 'Phase 7: server event stream adapter', 'medium', 'Single SSE stream for tree / agent-run / skills / MCP / sync change notifications; the Next route wraps the Product Server frame iterator in a ReadableStream and must stay a thin adapter without host-side event sources.'),
  optional('/api/export', 'Phase 5: content ingestion optional capabilities', 'high', 'Export/archive logic carries heavy dependencies and filesystem writes that need optional capability packaging.'),
  delegated('/api/extract-docx', 'high'),
  delegated('/api/extract-pdf', 'high'),
  optional('/api/file/import', 'Phase 5: content ingestion optional capabilities', 'high', 'File import is a content-ingestion write path and needs capability-level size limits, conflict checks, and rollback.'),
  delegated('/api/file/raw'),
  delegated('/api/file', 'high'),
  delegated('/api/files'),
  delegated('/api/git'),
  delegated('/api/graph'),
  delegated('/api/health'),
  delegated('/api/im/activity', 'medium'),
  delegated('/api/im/config', 'high'),
  host('/api/im/feishu/long-connection/event', 'Raw long-connection event delivery is host-specific, but event parsing and state updates should stay behind Product protocol handlers.', 'medium'),
  delegated('/api/im/feishu/oauth', 'high'),
  delegated('/api/im/feishu/oauth/callback', 'high'),
  delegated('/api/im/feishu/long-connection', 'high'),
  delegated('/api/im/status', 'medium'),
  delegated('/api/im/test', 'medium'),
  delegated('/api/im/webhook-status', 'medium'),
  host('/api/im/webhook/feishu', 'Raw inbound Feishu webhook receipt is host-owned, while signature verification and state writes should move to Product protocol handlers.', 'high'),
  optional('/api/inbox/clip', 'Phase 5: content ingestion optional capabilities', 'high', 'Inbox clipping is still Web-owned ingestion and needs optional capability packaging plus fetch timeout and content limits.'),
  delegated('/api/inbox', 'medium'),
  delegated('/api/init', 'high'),
  optional('/api/lint', 'Phase 5: content ingestion optional capabilities', 'medium', 'Knowledge linting remains Web-owned and should become an optional Product capability with bounded filesystem traversal.'),
  optional('/api/dreaming', 'Phase 5: content ingestion optional capabilities', 'medium', 'Dreaming remains Web-owned while the run artifact schema and review-first write boundary are still being validated.'),
  delegated('/api/mcp/agents', 'high'),
  delegated('/api/mcp/copy-server', 'high'),
  delegated('/api/mcp/direct-tools', 'medium'),
  delegated('/api/mcp/install-skill', 'high'),
  delegated('/api/mcp/install', 'high'),
  delegated('/api/mcp/verify', 'medium'),
  delegated('/api/mcp/restart', 'high'),
  delegated('/api/mcp/status'),
  delegated('/api/mcp/token/reveal', 'high'),
  delegated('/api/mcp/tools', 'medium'),
  delegated('/api/mcp/uninstall', 'high'),
  delegated('/api/monitoring', 'medium'),
  optional('/api/obsidian-plugins', 'Phase 5: content ingestion optional capabilities', 'medium', 'Obsidian plugin lifecycle state is still Web-owned while the compatibility host remains an optional runtime surface.'),
  optional('/api/obsidian-plugins/package', 'Phase 5: plugin optional capabilities', 'high', 'Read-only package approval subjects use Product byte snapshots; Web validates existing Obsidian manifests. Fingerprints do not grant runtime authority.'),
  optional('/api/obsidian-plugins/data', 'Phase 5: plugin optional capabilities', 'high', 'Product persists bounded plugin JSON with code/Vault binding and revision conflicts. Web authenticates requests; Desktop main separately enforces native configuration consent and session revocation.'),
  optional('/api/obsidian-plugins/vault', 'Phase 5: plugin optional capabilities', 'high', 'Product provides bounded visible Vault snapshots pinned to code and Vault identity. Desktop main enforces optional native read consent; API authentication alone does not represent native consent.'),
  optional('/api/obsidian-plugins/markdown-code-blocks', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian markdown code block snapshots remain Web-owned while document render hooks are still an optional compatibility surface.'),
  optional('/api/obsidian-plugins/markdown-post-processors', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian markdown post processor snapshots remain Web-owned while document render hooks are still an optional compatibility surface.'),
  optional('/api/obsidian-plugins/native-query', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian native query previews remain Web-owned because they read vault metadata and should stay behind the optional plugin capability boundary.'),
  optional('/api/obsidian-plugins/settings', 'Phase 5: content ingestion optional capabilities', 'medium', 'Obsidian plugin settings remain Web-owned and should be modeled as an optional Product compatibility capability.'),
  optional('/api/obsidian-plugins/styles', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian plugin stylesheet snapshots remain Web-owned and require scoped host enforcement before any browser injection.'),
  optional('/api/obsidian-plugins/views', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian plugin view snapshots remain Web-owned while custom view hosting is still an optional compatibility surface.'),
  optional('/api/obsidian/community-catalog', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian community catalog browsing remains Web-owned, read-only, and must not imply remote install/update without explicit capability gates.'),
  optional('/api/obsidian/community-catalog/install', 'Phase 5: plugin optional capabilities', 'high', 'Obsidian community install remains Web-owned and writes .plugins only after explicit confirmation, source validation, manifest id match, compatibility preflight, and rollback cleanup.'),
  optional('/api/obsidian/community-catalog/preflight', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian community plugin preflight remains Web-owned, read-only, and must not install, update, enable, load, or write .plugins without explicit capability gates.'),
  optional('/api/obsidian/community-catalog/update', 'Phase 5: plugin optional capabilities', 'high', 'Obsidian community update remains Web-owned and writes .plugins only after explicit confirmation, stale preview checks, manifest id match, compatibility preflight, runtime unload, and rollback cleanup.'),
  optional('/api/obsidian/community-catalog/update-plan', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian community update planning remains Web-owned, read-only, and must not write .plugins, change enabled state, or load plugin runtime while previewing package changes.'),
  optional('/api/obsidian/compat-report', 'Phase 5: content ingestion optional capabilities', 'medium', 'Obsidian compatibility reporting remains Web-owned and should use optional capability diagnostics.'),
  optional('/api/obsidian/import', 'Phase 5: content ingestion optional capabilities', 'high', 'Obsidian import remains a Web-owned bulk write path and needs optional capability size limits and rollback.'),
  optional('/api/plugins/catalog', 'Phase 5: plugin optional capabilities', 'medium', 'Plugin catalog aggregation remains Web-owned while MindOS renderers and Obsidian imported plugins converge under the optional plugin capability model.'),
  optional('/api/plugins/surfaces', 'Phase 5: plugin optional capabilities', 'medium', 'Plugin surface aggregation is still Web-owned while Obsidian compatibility and renderer plugin surfaces remain optional runtime capabilities.'),
  delegated('/api/recent-files'),
  delegated('/api/restart', 'high'),
  delegated('/api/search/prewarm'),
  delegated('/api/search'),
  delegated('/api/context-assets'),
  delegated('/api/retrieval-receipts'),
  delegated('/api/context-feedback', 'high'),
  delegated('/api/studio/automations', 'high'),
  delegated('/api/settings/list-models', 'medium'),
  host('/api/settings/model-thinking', 'Concrete model thinking capability resolution depends on the Web host Pi model catalog and active provider settings until Product Server owns the shared Models runtime boundary.', 'medium'),
  delegated('/api/settings/reset-token', 'high'),
  delegated('/api/settings', 'medium'),
  delegated('/api/settings/test-key', 'medium'),
  delegated('/api/setup/check-path', 'medium'),
  delegated('/api/setup/check-port', 'medium'),
  delegated('/api/setup/generate-token', 'medium'),
  delegated('/api/setup/ls', 'medium'),
  delegated('/api/setup', 'high'),
  optional('/api/skill-market/search', 'Phase 5: plugin optional capabilities', 'medium', 'Skill market search is still Web-owned because it combines remote catalog fetches, host runtime skill discovery, and in-memory cache state that need optional capability boundaries.'),
  delegated('/api/skills', 'high'),
  delegated('/api/skills/matrix', 'high'),
  delegated('/api/skills/runtime-matches', 'medium'),
  delegated('/api/space-overview'),
  delegated('/api/sync', 'high'),
  delegated('/api/tree-version'),
  delegated('/api/uninstall', 'high'),
  delegated('/api/update-check'),
  delegated('/api/update-status'),
  delegated('/api/update', 'high'),
  delegated('/api/workflows', 'medium'),
];

const ownershipByPath = new Map(MINDOS_WEB_API_ROUTE_OWNERSHIP.map((route) => [route.path, route]));

export function getMindosWebApiRouteOwnership(path: string): MindosWebApiRouteOwnership | undefined {
  return ownershipByPath.get(path);
}
