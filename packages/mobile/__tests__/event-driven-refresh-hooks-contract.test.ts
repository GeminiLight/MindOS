import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Source-level contract for the polling-to-events conversion. The mobile
 * package has no React renderer in its test toolchain, so the scheduling
 * behaviour is covered by `event-driven-refresh.test.ts` and
 * `server-events.test.ts`; this file locks the wiring so a hook cannot quietly
 * grow an unconditional `setInterval` again.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8');

const CONVERTED_HOOKS = [
  'hooks/useRecentAgentActivity.ts',
  'hooks/usePendingAgentActions.ts',
  'hooks/useAgentRunTimeline.ts',
];

describe('mobile event-driven refresh wiring', () => {
  it.each(CONVERTED_HOOKS)('%s no longer owns a setInterval or AppState listener', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\bsetInterval\s*\(/);
    expect(source).not.toMatch(/AppState\.addEventListener/);
    expect(source).toMatch(/useEventDrivenRefresh|startEventDrivenRefresh/);
    expect(source).toContain("'agent-run.event'");
  });

  it('keeps manual refresh entry points on the converted hooks for pull-to-refresh', () => {
    for (const file of ['hooks/useRecentAgentActivity.ts', 'hooks/usePendingAgentActions.ts']) {
      expect(read(file), file).toMatch(/\n\s+refresh,\n/);
    }
  });

  it('keeps the previous poll periods as the not-connected fallback', () => {
    expect(read('hooks/useRecentAgentActivity.ts')).toMatch(/pollIntervalMs = 4000/);
    expect(read('hooks/usePendingAgentActions.ts')).toMatch(/pollIntervalMs = 2500/);
    expect(read('hooks/useAgentRunTimeline.ts')).toMatch(/DEFAULT_POLL_MS = 1200/);
    for (const file of CONVERTED_HOOKS) {
      expect(read(file), file).toMatch(/fallbackPollMs: (pollIntervalMs|pollMs)/);
    }
  });

  it('keeps a slow connected poll for pending actions because automation approvals have no server event', () => {
    const source = read('hooks/usePendingAgentActions.ts');
    const match = source.match(/PENDING_AGENT_ACTIONS_CONNECTED_POLL_MS\s*=\s*([\d_]+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1].replace(/_/g, ''))).toBeGreaterThanOrEqual(10_000);
    expect(source).toContain('connectedPollMs: PENDING_AGENT_ACTIONS_CONNECTED_POLL_MS');
    expect(source).toContain('accept: isPendingAgentActionEvent');
  });

  it('does not add a connected poll anywhere else', () => {
    for (const file of ['hooks/useRecentAgentActivity.ts', 'hooks/useAgentRunTimeline.ts', 'hooks/useAgentRuntimes.ts', 'app/(tabs)/index.tsx', 'app/(tabs)/files.tsx']) {
      expect(read(file), file).not.toMatch(/connectedPollMs/);
    }
  });

  it('scopes timeline refreshes to the active chat session', () => {
    const source = read('hooks/useAgentRunTimeline.ts');
    expect(source).toMatch(/event\.chatSessionId === chatSessionId/);
  });

  it('refreshes the file tree screens on tree.changed without adding a poll', () => {
    for (const file of ['app/(tabs)/index.tsx', 'app/(tabs)/files.tsx']) {
      const source = read(file);
      expect(source, file).toContain("'tree.changed'");
      expect(source, file).toMatch(/useEventDrivenRefresh\(/);
      expect(source, file).toMatch(/enabled: status === 'connected'/);
      expect(source, file).not.toMatch(/fallbackPollMs|\bsetInterval\s*\(/);
      expect(source, file).toMatch(/RefreshControl/);
    }
  });

  it('refreshes agent runtimes on mcp.changed without a spinner', () => {
    const source = read('hooks/useAgentRuntimes.ts');
    expect(source).toContain("'mcp.changed'");
    expect(source).toMatch(/useEventDrivenRefresh\(/);
    expect(source).toMatch(/silent: true/);
  });

  it('streams /api/events through expo/fetch rather than the global fetch, XHR or the timeout client', () => {
    const source = read('lib/server-events.ts');
    expect(source).toMatch(/import \{ fetch as expoFetch \} from 'expo\/fetch'/);
    expect(source).not.toMatch(/globalThis\.fetch|window\.fetch|XMLHttpRequest|fetchWithTimeout/);
    expect(source).toContain("Accept: 'text/event-stream'");
    expect(source).toContain("'Last-Event-ID'");
  });

  it('keeps the new modules well under the file size budget', () => {
    for (const file of [
      'lib/server-events.ts',
      'lib/sse-parser.ts',
      'lib/event-driven-refresh.ts',
      'hooks/useEventDrivenRefresh.ts',
    ]) {
      expect(read(file).split('\n').length, file).toBeLessThan(1000);
    }
  });
});
