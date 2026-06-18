export type MindosWebApiRouteOwner =
  | 'product-owned'
  | 'host-owned'
  | 'optional-capability';

export type MindosWebApiRouteAdapter =
  | 'next-response'
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

const migrated = (path: string, risk: MindosWebApiRouteRisk = 'low') =>
  route(
    path,
    'product-owned',
    'next-response',
    'Phase 1: migrated Product Server adapter',
    risk,
    'No residual product ownership expected; this route should remain a thin Next adapter.',
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
  migrated('/api/a2a/agents', 'medium'),
  migrated('/api/a2a/delegations', 'medium'),
  migrated('/api/a2a/discover', 'medium'),
  migrated('/api/a2a', 'medium'),
  migrated('/api/acp/config', 'high'),
  migrated('/api/acp/detect', 'medium'),
  migrated('/api/acp/install', 'high'),
  migrated('/api/acp/registry', 'medium'),
  migrated('/api/acp/session', 'high'),
  migrated('/api/agent-activity'),
  host('/api/agent-runs', 'Agent run timeline state is currently stored in the Web host ledger and should stay classified until Product Server owns run persistence.', 'medium'),
  host('/api/agent-runs/stream', 'Agent run timeline streaming subscribes to the Web host in-process ledger and must stay host-owned until Product Server owns run persistence and event fanout.', 'medium'),
  host('/api/assistant-runs', 'Assistant run execution currently resolves Web-owned runners and writes the Web host agent run ledger; Product Server owns the profile registry only until Runtime Context and Schedule persistence are promoted.', 'medium'),
  migrated('/api/assistants', 'medium'),
  migrated('/api/agent-runtimes', 'medium'),
  migrated('/api/agent-runtimes/codex/threads', 'medium'),
  migrated('/api/agent-runtimes/codex/threads/[threadId]', 'medium'),
  migrated('/api/agent-runtimes/codex/threads/[threadId]/archive', 'medium'),
  migrated('/api/agent-runtimes/codex/threads/[threadId]/fork', 'medium'),
  migrated('/api/agent-runtimes/codex/threads/[threadId]/unarchive', 'medium'),
  migrated('/api/agents/copy-skill', 'high'),
  migrated('/api/agents/custom/detect', 'medium'),
  migrated('/api/agents/custom', 'high'),
  migrated('/api/agent-capabilities', 'medium'),
  migrated('/api/ask-sessions'),
  route('/api/ask', 'product-owned', 'stream', 'Phase 6: generated client and stream adapter', 'high', 'Ask is mostly Product runtime-owned through session and agent modules, but the streaming Web route still owns host assembly and should become a generated stream adapter.'),
  host('/api/ask/runtime-permission', 'Runtime permission decisions are per active Web ask run and use in-memory bridge state owned by the host Chat Panel.', 'high'),
  host('/api/ask/runtime-permission/request', 'Native runtime permission requests are per active Web ask run and use in-memory bridge state owned by the host Chat Panel.', 'high'),
  host('/api/ask/user-question', 'Native runtime user-question answers are per active Web ask run and use in-memory bridge state owned by the host Chat Panel.', 'high'),
  host('/api/ask/user-question/request', 'Native runtime user-question requests are per active Web ask run and use in-memory bridge state owned by the host Chat Panel.', 'high'),
  host('/api/auth', 'Auth cookie/session handling is host-specific today; Product Server will need an auth context adapter before direct HTTP exposure.', 'high'),
  migrated('/api/backlinks'),
  migrated('/api/bootstrap'),
  migrated('/api/changes'),
  migrated('/api/channels/verify', 'medium'),
  migrated('/api/connect'),
  migrated('/api/embedding', 'medium'),
  optional('/api/export', 'Phase 5: content ingestion optional capabilities', 'high', 'Export/archive logic carries heavy dependencies and filesystem writes that need optional capability packaging.'),
  migrated('/api/extract-docx', 'high'),
  migrated('/api/extract-pdf', 'high'),
  optional('/api/file/import', 'Phase 5: content ingestion optional capabilities', 'high', 'File import is a content-ingestion write path and needs capability-level size limits, conflict checks, and rollback.'),
  migrated('/api/file/raw'),
  migrated('/api/file', 'high'),
  migrated('/api/files'),
  migrated('/api/git'),
  migrated('/api/graph'),
  migrated('/api/health'),
  migrated('/api/im/activity', 'medium'),
  migrated('/api/im/config', 'high'),
  host('/api/im/feishu/long-connection/event', 'Raw long-connection event delivery is host-specific, but event parsing and state updates should stay behind Product protocol handlers.', 'medium'),
  migrated('/api/im/feishu/oauth', 'high'),
  migrated('/api/im/feishu/oauth/callback', 'high'),
  migrated('/api/im/feishu/long-connection', 'high'),
  migrated('/api/im/status', 'medium'),
  migrated('/api/im/test', 'medium'),
  migrated('/api/im/webhook-status', 'medium'),
  host('/api/im/webhook/feishu', 'Raw inbound Feishu webhook receipt is host-owned, while signature verification and state writes should move to Product protocol handlers.', 'high'),
  optional('/api/inbox/clip', 'Phase 5: content ingestion optional capabilities', 'high', 'Inbox clipping is still Web-owned ingestion and needs optional capability packaging plus fetch timeout and content limits.'),
  migrated('/api/inbox', 'medium'),
  migrated('/api/init', 'high'),
  optional('/api/lint', 'Phase 5: content ingestion optional capabilities', 'medium', 'Knowledge linting remains Web-owned and should become an optional Product capability with bounded filesystem traversal.'),
  optional('/api/dreaming', 'Phase 5: content ingestion optional capabilities', 'medium', 'Dreaming remains Web-owned while the run artifact schema and review-first write boundary are still being validated.'),
  migrated('/api/mcp/agents', 'high'),
  migrated('/api/mcp/copy-server', 'high'),
  migrated('/api/mcp/direct-tools', 'medium'),
  migrated('/api/mcp/install-skill', 'high'),
  migrated('/api/mcp/install', 'high'),
  migrated('/api/mcp/restart', 'high'),
  migrated('/api/mcp/status'),
  migrated('/api/mcp/token/reveal', 'high'),
  migrated('/api/mcp/tools', 'medium'),
  migrated('/api/mcp/uninstall', 'high'),
  migrated('/api/monitoring', 'medium'),
  optional('/api/obsidian-plugins', 'Phase 5: content ingestion optional capabilities', 'medium', 'Obsidian plugin lifecycle state is still Web-owned while the compatibility host remains an optional runtime surface.'),
  optional('/api/obsidian-plugins/markdown-code-blocks', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian markdown code block snapshots remain Web-owned while document render hooks are still an optional compatibility surface.'),
  optional('/api/obsidian-plugins/markdown-post-processors', 'Phase 5: plugin optional capabilities', 'medium', 'Obsidian markdown post processor snapshots remain Web-owned while document render hooks are still an optional compatibility surface.'),
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
  migrated('/api/recent-files'),
  migrated('/api/restart', 'high'),
  migrated('/api/search/prewarm'),
  migrated('/api/search'),
  migrated('/api/settings/list-models', 'medium'),
  migrated('/api/settings/reset-token', 'high'),
  migrated('/api/settings', 'medium'),
  migrated('/api/settings/test-key', 'medium'),
  migrated('/api/setup/check-path', 'medium'),
  migrated('/api/setup/check-port', 'medium'),
  migrated('/api/setup/generate-token', 'medium'),
  migrated('/api/setup/ls', 'medium'),
  migrated('/api/setup', 'high'),
  optional('/api/skill-market/search', 'Phase 5: plugin optional capabilities', 'medium', 'Skill market search is still Web-owned because it combines remote catalog fetches, host runtime skill discovery, and in-memory cache state that need optional capability boundaries.'),
  migrated('/api/skills', 'high'),
  migrated('/api/skills/matrix', 'high'),
  migrated('/api/space-overview'),
  migrated('/api/sync', 'high'),
  migrated('/api/tree-version'),
  migrated('/api/uninstall', 'high'),
  migrated('/api/update-check'),
  migrated('/api/update-status'),
  migrated('/api/update', 'high'),
  migrated('/api/workflows', 'medium'),
];

const ownershipByPath = new Map(MINDOS_WEB_API_ROUTE_OWNERSHIP.map((route) => [route.path, route]));

export function getMindosWebApiRouteOwnership(path: string): MindosWebApiRouteOwnership | undefined {
  return ownershipByPath.get(path);
}
