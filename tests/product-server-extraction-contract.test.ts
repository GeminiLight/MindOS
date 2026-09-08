import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

/** The Product Server route table (`routes/*.ts`) is the single source of the HTTP surface; read it as one text. */
function readRouteTable(): string {
  const dir = resolve(root, 'packages/mindos/src/server/routes');
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .sort()
    .map((entry) => readFileSync(resolve(dir, entry), 'utf-8'))
    .join('\n');
}

describe('Product server extraction contract', () => {
  it('documents the full Product Server extraction plan', () => {
    const specPath = 'wiki/specs/spec-product-server-extraction.md';
    expect(existsSync(resolve(root, specPath))).toBe(true);
    const spec = read(specPath);

    expect(spec).toContain('Product Server');
    expect(spec).toContain('Next standalone');
    expect(spec).toContain('/api/agent/sessions/[sessionId]/turns');
    expect(spec).toContain('static Web artifact');
    expect(spec).toContain('OpenCode');
  });

  it('moves product HTTP ownership into @geminilight/mindos/server', () => {
    const serverIndex = read('packages/mindos/src/server/index.ts');
    const http = read('packages/mindos/src/server/http.ts');
    const routes = readRouteTable();
    const runtime = read('packages/mindos/src/server/runtime.ts');

    expect(serverIndex).toContain('createMindosHttpServer');
    expect(serverIndex).toContain('createDefaultMindosHttpServices');
    expect(http).toContain('createServer');
    expect(routes).toContain('/api/recent-files');
    expect(routes).toContain('/api/file');
    expect(routes).toContain('/api/extract-pdf');
    expect(routes).toContain('/api/extract-docx');
    expect(routes).toContain('/api/agent/sessions/');
    expect(http).not.toContain("route === 'POST /api/ask'");
    expect(routes).toContain('/api/agent/sessions/');
    expect(routes).toContain('/api/a2a');
    expect(routes).toContain('/api/a2a/agents');
    expect(routes).toContain('/api/a2a/delegations');
    expect(routes).toContain('/api/a2a/discover');
    expect(routes).toContain('/api/acp/config');
    expect(routes).toContain('/api/acp/detect');
    expect(routes).toContain('/api/acp/install');
    expect(routes).toContain('/api/acp/registry');
    expect(routes).toContain('/api/acp/session');
    expect(routes).toContain('/api/tree-version');
    expect(routes).toContain('/api/search/prewarm');
    expect(routes).toContain('/api/backlinks');
    expect(routes).toContain('/api/graph');
    expect(routes).toContain('/api/agent-activity');
    expect(routes).toContain('/api/agent-runtimes');
    expect(routes).toContain('/api/agent-runtimes/extensions');
    expect(routes).toContain('/api/agent-runtimes/extensions/preflight');
    expect(routes).toContain('/api/agent-runtimes/extensions/install');
    expect(routes).toContain('/api/agent-runtimes/codex/threads');
    expect(routes).toContain('/api/agent/sessions');
    expect(routes).toContain('/api/space-overview');
    expect(routes).toContain('/api/git');
    expect(routes).toContain('/api/inbox');
    expect(routes).toContain('/api/setup/check-path');
    expect(routes).toContain('/api/setup/ls');
    expect(routes).toContain('/api/setup');
    expect(routes).toContain('/api/bootstrap');
    expect(routes).toContain('/api/connect');
    expect(routes).toContain('/api/embedding');
    expect(routes).toContain('/api/channels/verify');
    expect(routes).toContain('/api/im/activity');
    expect(routes).toContain('/api/im/config');
    expect(routes).toContain('/api/im/status');
    expect(routes).toContain('/api/im/test');
    expect(routes).toContain('/api/im/webhook-status');
    expect(routes).toContain('/api/im/feishu/oauth');
    expect(routes).toContain('/api/im/feishu/oauth/callback');
    expect(routes).toContain('/api/im/feishu/long-connection');
    expect(routes).toContain('/api/monitoring');
    expect(routes).toContain('/api/update-status');
    expect(routes).toContain('/api/update-check');
    expect(routes).toContain('/api/restart');
    expect(routes).toContain('/api/update');
    expect(routes).toContain('/api/uninstall');
    expect(routes).toContain('/api/init');
    expect(routes).toContain('/api/sync');
    expect(routes).toContain('/api/setup/check-port');
    expect(routes).toContain('/api/setup/generate-token');
    expect(routes).toContain('/api/workflows');
    expect(routes).toContain('/api/skills');
    expect(routes).toContain('/api/changes');
    expect(routes).toContain('/api/settings/test-key');
    expect(routes).toContain('/api/settings/list-models');
    expect(runtime).toContain('collectAllFilesFromMindRoot');
    expect(runtime).toContain('getRecentlyModifiedFromMindRoot');
  });

  it('adds product-owned route contracts for foundational knowledge APIs', () => {
    const contract = readRouteTable();

    expect(contract).toContain("id: 'recent-files'");
    expect(contract).toContain("path: '/api/recent-files'");
    expect(contract).toContain("id: 'file.read'");
    expect(contract).toContain("path: '/api/file'");
    expect(contract).toContain("id: 'extract-pdf'");
    expect(contract).toContain("path: '/api/extract-pdf'");
    expect(contract).toContain("id: 'extract-docx'");
    expect(contract).toContain("path: '/api/extract-docx'");
    expect(contract).toContain("id: 'agent.sessions.turns.create'");
    expect(contract).toContain("path: '/api/agent/sessions/[sessionId]/turns'");
    expect(contract).toContain("id: 'a2a'");
    expect(contract).toContain("id: 'a2a.agents'");
    expect(contract).toContain("id: 'a2a.delegations'");
    expect(contract).toContain("id: 'a2a.discover'");
    expect(contract).toContain("path: '/api/a2a'");
    expect(contract).toContain("id: 'acp.config'");
    expect(contract).toContain("id: 'acp.detect'");
    expect(contract).toContain("id: 'acp.install'");
    expect(contract).toContain("id: 'acp.registry'");
    expect(contract).toContain("id: 'acp.session'");
    expect(contract).toContain("path: '/api/acp/session'");
    expect(contract).toContain("id: 'tree-version'");
    expect(contract).toContain("path: '/api/tree-version'");
    expect(contract).toContain("id: 'search.prewarm'");
    expect(contract).toContain("path: '/api/search/prewarm'");
    expect(contract).toContain("id: 'backlinks'");
    expect(contract).toContain("path: '/api/backlinks'");
    expect(contract).toContain("id: 'graph'");
    expect(contract).toContain("path: '/api/graph'");
    expect(contract).toContain("id: 'agent-activity'");
    expect(contract).toContain("id: 'agent-activity.append'");
    expect(contract).toContain("path: '/api/agent-activity'");
    expect(contract).toContain("id: 'agent-runtimes'");
    expect(contract).toContain("path: '/api/agent-runtimes'");
    expect(contract).toContain("id: 'agent-runtimes.extensions'");
    expect(contract).toContain("path: '/api/agent-runtimes/extensions'");
    expect(contract).toContain("id: 'agent-runtimes.extensions.preflight'");
    expect(contract).toContain("path: '/api/agent-runtimes/extensions/preflight'");
    expect(contract).toContain("id: 'agent-runtimes.extensions.install'");
    expect(contract).toContain("path: '/api/agent-runtimes/extensions/install'");
    expect(contract).toContain("id: 'agent-runtimes.codex.threads'");
    expect(contract).toContain("path: '/api/agent-runtimes/codex/threads'");
    expect(contract).toContain("id: 'agent-runtimes.codex.thread'");
    expect(contract).toContain("path: '/api/agent-runtimes/codex/threads/[threadId]'");
    expect(contract).toContain("id: 'agent-runtimes.codex.thread.fork'");
    expect(contract).toContain("id: 'agent-runtimes.codex.thread.archive'");
    expect(contract).toContain("id: 'agent-runtimes.codex.thread.unarchive'");
    expect(contract).toContain("id: 'agent-sessions'");
    expect(contract).toContain("path: '/api/agent/sessions'");
    expect(contract).toContain("id: 'space-overview'");
    expect(contract).toContain("path: '/api/space-overview'");
    expect(contract).toContain("id: 'git'");
    expect(contract).toContain("path: '/api/git'");
    expect(contract).toContain("id: 'inbox'");
    expect(contract).toContain("path: '/api/inbox'");
    expect(contract).toContain("id: 'setup.check-path'");
    expect(contract).toContain("path: '/api/setup/check-path'");
    expect(contract).toContain("id: 'setup.ls'");
    expect(contract).toContain("path: '/api/setup/ls'");
    expect(contract).toContain("id: 'bootstrap'");
    expect(contract).toContain("path: '/api/bootstrap'");
    expect(contract).toContain("id: 'connect'");
    expect(contract).toContain("path: '/api/connect'");
    expect(contract).toContain("id: 'embedding'");
    expect(contract).toContain("id: 'embedding.action'");
    expect(contract).toContain("path: '/api/embedding'");
    expect(contract).toContain("id: 'channels.verify'");
    expect(contract).toContain("path: '/api/channels/verify'");
    expect(contract).toContain("id: 'im.activity'");
    expect(contract).toContain("path: '/api/im/activity'");
    expect(contract).toContain("id: 'im.config'");
    expect(contract).toContain("id: 'im.config.update'");
    expect(contract).toContain("id: 'im.config.delete'");
    expect(contract).toContain("path: '/api/im/config'");
    expect(contract).toContain("id: 'im.status'");
    expect(contract).toContain("path: '/api/im/status'");
    expect(contract).toContain("id: 'im.test'");
    expect(contract).toContain("path: '/api/im/test'");
    expect(contract).toContain("id: 'im.webhook-status'");
    expect(contract).toContain("path: '/api/im/webhook-status'");
    expect(contract).toContain("id: 'im.feishu.oauth'");
    expect(contract).toContain("path: '/api/im/feishu/oauth'");
    expect(contract).toContain("id: 'im.feishu.oauth.callback'");
    expect(contract).toContain("path: '/api/im/feishu/oauth/callback'");
    expect(contract).toContain("id: 'im.feishu.long-connection'");
    expect(contract).toContain("path: '/api/im/feishu/long-connection'");
    expect(contract).toContain("id: 'monitoring'");
    expect(contract).toContain("path: '/api/monitoring'");
    expect(contract).toContain("id: 'update-status'");
    expect(contract).toContain("path: '/api/update-status'");
    expect(contract).toContain("id: 'update-check'");
    expect(contract).toContain("path: '/api/update-check'");
    expect(contract).toContain("id: 'restart'");
    expect(contract).toContain("path: '/api/restart'");
    expect(contract).toContain("id: 'update'");
    expect(contract).toContain("path: '/api/update'");
    expect(contract).toContain("id: 'uninstall'");
    expect(contract).toContain("path: '/api/uninstall'");
    expect(contract).toContain("id: 'init'");
    expect(contract).toContain("path: '/api/init'");
    expect(contract).toContain("id: 'sync'");
    expect(contract).toContain("id: 'sync.action'");
    expect(contract).toContain("path: '/api/sync'");
    expect(contract).toContain("id: 'setup.check-port'");
    expect(contract).toContain("path: '/api/setup/check-port'");
    expect(contract).toContain("id: 'setup.generate-token'");
    expect(contract).toContain("path: '/api/setup/generate-token'");
    expect(contract).toContain("id: 'setup'");
    expect(contract).toContain("id: 'setup.apply'");
    expect(contract).toContain("id: 'setup.guide-state'");
    expect(contract).toContain("path: '/api/setup'");
    expect(contract).toContain("id: 'workflows'");
    expect(contract).toContain("path: '/api/workflows'");
    expect(contract).toContain("id: 'skills'");
    expect(contract).toContain("path: '/api/skills'");
    expect(contract).toContain("id: 'skills.action'");
    expect(contract).toContain("id: 'settings.reset-token'");
    expect(contract).toContain("id: 'settings.test-key'");
    expect(contract).toContain("path: '/api/settings/test-key'");
    expect(contract).toContain("id: 'settings.list-models'");
    expect(contract).toContain("path: '/api/settings/list-models'");
    expect(contract).toContain("id: 'mcp.tools'");
    expect(contract).toContain("id: 'mcp.agents'");
    expect(contract).toContain("id: 'mcp.direct-tools'");
    expect(contract).toContain("id: 'mcp.install'");
    expect(contract).toContain("id: 'mcp.install-skill'");
    expect(contract).toContain("id: 'mcp.restart'");
    expect(contract).toContain("id: 'mcp.uninstall'");
    expect(contract).toContain("id: 'agents.custom.create'");
    expect(contract).toContain("id: 'agents.custom.detect'");
    expect(contract).toContain("id: 'agents.copy-skill'");
    expect(contract).toContain("id: 'changes'");
    expect(contract).toContain("path: '/api/changes'");
  });

  it('keeps Web API routes as adapters for migrated product-owned routes', () => {
    const migratedRoutes = [
      'packages/web/app/api/health/route.ts',
      'packages/web/app/api/files/route.ts',
      'packages/web/app/api/recent-files/route.ts',
      'packages/web/app/api/file/route.ts',
      'packages/web/app/api/extract-pdf/route.ts',
      'packages/web/app/api/extract-docx/route.ts',
      'packages/web/app/api/file/raw/route.ts',
      'packages/web/app/api/a2a/route.ts',
      'packages/web/app/api/a2a/agents/route.ts',
      'packages/web/app/api/a2a/delegations/route.ts',
      'packages/web/app/api/a2a/discover/route.ts',
      'packages/web/app/api/acp/config/route.ts',
      'packages/web/app/api/acp/detect/route.ts',
      'packages/web/app/api/acp/install/route.ts',
      'packages/web/app/api/acp/registry/route.ts',
      'packages/web/app/api/acp/session/route.ts',
      'packages/web/app/api/search/route.ts',
      'packages/web/app/api/search/prewarm/route.ts',
      'packages/web/app/api/backlinks/route.ts',
      'packages/web/app/api/graph/route.ts',
      'packages/web/app/api/agent-activity/route.ts',
      'packages/web/app/api/agent-capabilities/route.ts',
      'packages/web/app/api/agent-runtimes/route.ts',
      'packages/web/app/api/agent-runtimes/extensions/route.ts',
      'packages/web/app/api/agent-runtimes/extensions/preflight/route.ts',
      'packages/web/app/api/agent-runtimes/extensions/install/route.ts',
      'packages/web/app/api/agent-runtimes/codex/threads/route.ts',
      'packages/web/app/api/agent-runtimes/codex/threads/[threadId]/route.ts',
      'packages/web/app/api/agent-runtimes/codex/threads/[threadId]/archive/route.ts',
      'packages/web/app/api/agent-runtimes/codex/threads/[threadId]/fork/route.ts',
      'packages/web/app/api/agent-runtimes/codex/threads/[threadId]/unarchive/route.ts',
      'packages/web/app/api/agent/sessions/route.ts',
      'packages/web/app/api/space-overview/route.ts',
      'packages/web/app/api/git/route.ts',
      'packages/web/app/api/inbox/route.ts',
      'packages/web/app/api/setup/check-path/route.ts',
      'packages/web/app/api/setup/ls/route.ts',
      'packages/web/app/api/bootstrap/route.ts',
      'packages/web/app/api/connect/route.ts',
      'packages/web/app/api/embedding/route.ts',
      'packages/web/app/api/channels/verify/route.ts',
      'packages/web/app/api/im/activity/route.ts',
      'packages/web/app/api/im/config/route.ts',
      'packages/web/app/api/im/status/route.ts',
      'packages/web/app/api/im/test/route.ts',
      'packages/web/app/api/im/webhook-status/route.ts',
      'packages/web/app/api/im/feishu/oauth/route.ts',
      'packages/web/app/api/im/feishu/oauth/callback/route.ts',
      'packages/web/app/api/im/feishu/long-connection/route.ts',
      'packages/web/app/api/monitoring/route.ts',
      'packages/web/app/api/update-status/route.ts',
      'packages/web/app/api/update-check/route.ts',
      'packages/web/app/api/restart/route.ts',
      'packages/web/app/api/update/route.ts',
      'packages/web/app/api/uninstall/route.ts',
      'packages/web/app/api/init/route.ts',
      'packages/web/app/api/sync/route.ts',
      'packages/web/app/api/setup/check-port/route.ts',
      'packages/web/app/api/setup/generate-token/route.ts',
      'packages/web/app/api/setup/route.ts',
      'packages/web/app/api/workflows/route.ts',
      'packages/web/app/api/changes/route.ts',
      'packages/web/app/api/skills/route.ts',
      'packages/web/app/api/settings/route.ts',
      'packages/web/app/api/settings/reset-token/route.ts',
      'packages/web/app/api/settings/test-key/route.ts',
      'packages/web/app/api/settings/list-models/route.ts',
      'packages/web/app/api/agents/custom/route.ts',
      'packages/web/app/api/agents/custom/detect/route.ts',
      'packages/web/app/api/agents/copy-skill/route.ts',
      'packages/web/app/api/mcp/status/route.ts',
      'packages/web/app/api/mcp/agents/route.ts',
      'packages/web/app/api/mcp/tools/route.ts',
      'packages/web/app/api/mcp/direct-tools/route.ts',
      'packages/web/app/api/mcp/install/route.ts',
      'packages/web/app/api/mcp/install-skill/route.ts',
      'packages/web/app/api/mcp/restart/route.ts',
      'packages/web/app/api/mcp/token/reveal/route.ts',
      'packages/web/app/api/mcp/uninstall/route.ts',
      'packages/web/app/api/tree-version/route.ts',
    ];

    for (const route of migratedRoutes) {
      const source = read(route);
      // Thin adapters either call a product handler and convert with
      // toNextResponse, or hand the request to the shared Hono route table.
      expect(source, route).toMatch(/@geminilight\/mindos\/server|_mindos-adapter/);
      expect(source, route).toMatch(/toNextResponse|delegateToMindos/);
    }
  });

  it('keeps start command aware of the product HTTP server path', () => {
    const start = read('packages/mindos/bin/commands/start.js');

    expect(start).toContain('MINDOS_PRODUCT_SERVER');
    expect(start).toContain('createMindosHttpServer');
  });
});
