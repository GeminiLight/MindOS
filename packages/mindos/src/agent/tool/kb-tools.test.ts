/**
 * Behavior tests for the host-injected KB toolkit (Wave 3,
 * spec-agent-core-consolidation). A fake in-memory host stands in for the
 * web app's fs/search/skills services; write locks, run-ledger file events,
 * permission filtering, and output shaping are exercised for real.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { runWithAgentRunContext } from '../agent-run-context.js';
import { createMindosAgentPermissionPolicy } from './permission-policy.js';
import { listAgentEvents, resetAgentRunsForTest, startAgentRun } from '../run-ledger.js';
import {
  CHAT_TOOL_NAMES,
  createMindosKbToolkit,
  truncate,
  WRITE_TOOLS,
  type MindosAgentTool,
  type MindosKbToolsHost,
} from './kb-tools.js';

function createFakeHost(overrides: Partial<MindosKbToolsHost> = {}) {
  const store = new Map<string, string>();
  const host: MindosKbToolsHost = {
    files: {
      getMindRoot: () => '/fake/mind-root',
      getFileTree: () => {
        const dirs = new Map<string, Array<{ name: string; type: string; children?: never[] }>>();
        for (const filePath of [...store.keys()].sort()) {
          const segments = filePath.split('/');
          const dir = segments.slice(0, -1).join('/');
          if (!dirs.has(dir)) dirs.set(dir, []);
          dirs.get(dir)!.push({ name: segments.at(-1)!, type: 'file' });
        }
        const rootEntries = [...(dirs.get('') ?? [])];
        for (const [dir, children] of dirs) {
          if (dir === '') continue;
          rootEntries.push({ name: dir, type: 'directory', children } as never);
        }
        return rootEntries;
      },
      getFileContent: (filePath) => {
        const content = store.get(filePath);
        if (content === undefined) throw new Error(`File not found: ${filePath}`);
        return content;
      },
      getRecentlyModified: (limit) =>
        [...store.keys()].slice(0, limit).map((p) => ({ path: p, mtime: 0 })),
      saveFileContent: (filePath, content) => {
        if (!store.has(filePath)) throw new Error(`File not found: ${filePath}`);
        store.set(filePath, content);
      },
      createFile: (filePath, content) => {
        if (store.has(filePath)) throw new Error(`File already exists: ${filePath}`);
        store.set(filePath, content);
      },
      appendToFile: (filePath, content) => {
        const before = store.get(filePath);
        if (before === undefined) throw new Error(`File not found: ${filePath}`);
        store.set(filePath, `${before}\n\n${content}`);
      },
      insertAfterHeading: () => { throw new Error('not implemented in fake'); },
      updateSection: () => { throw new Error('not implemented in fake'); },
      updateLines: () => { throw new Error('not implemented in fake'); },
      moveToTrashFile: (filePath) => {
        if (!store.delete(filePath)) throw new Error(`File not found: ${filePath}`);
        return { id: 'trash-1' };
      },
      renameFile: (filePath, newName) => {
        const content = store.get(filePath);
        if (content === undefined) throw new Error(`File not found: ${filePath}`);
        store.delete(filePath);
        const segments = filePath.split('/');
        segments[segments.length - 1] = newName;
        const newPath = segments.join('/');
        store.set(newPath, content);
        return newPath;
      },
      moveFile: (fromPath, toPath) => {
        const content = store.get(fromPath);
        if (content === undefined) throw new Error(`File not found: ${fromPath}`);
        store.delete(fromPath);
        store.set(toPath, content);
        return { newPath: toPath, affectedFiles: [] };
      },
      findBacklinks: () => [],
      gitLog: () => [],
      gitShowFile: () => { throw new Error('no git in fake'); },
      appendCsvRow: () => ({ newRowCount: 1 }),
    },
    hybridSearch: async () => [],
    readSkillContent: () => null,
    ...overrides,
  };
  return { host, store };
}

describe('createMindosKbToolkit', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-kb-tools-'));
    setMindRootResolverForTests(() => root);
    resetAgentRunsForTest();
  });

  afterEach(() => {
    resetAgentRunsForTest();
    setMindRootResolverForTests(null);
    rmSync(root, { recursive: true, force: true });
  });

  async function callTool(tool: MindosAgentTool | undefined, params: Record<string, unknown>): Promise<string> {
    if (!tool) throw new Error('tool missing');
    const result = await tool.execute('test-call', params);
    const textPart = result.content?.find((part: { type: string }) => part.type === 'text') as { text?: string } | undefined;
    return textPart?.text ?? '';
  }

  it('builds the full KB tool array with stable tool names', () => {
    const { host } = createFakeHost();
    const toolkit = createMindosKbToolkit(host);
    const names = toolkit.knowledgeBaseTools.map((tool) => tool.name);
    expect(names).toEqual([
      'list_files', 'read_file', 'read_file_chunk', 'search', 'load_skill', 'get_recent',
      'write_file', 'create_file', 'batch_create_files', 'append_to_file',
      'insert_after_heading', 'update_section', 'edit_lines', 'delete_file',
      'rename_file', 'move_file', 'get_backlinks', 'get_history',
      'get_file_at_version', 'append_csv', 'lint', 'dreaming', 'compile',
    ]);
  });

  it('filters tools by permission policy and appends delegation tools per scope', () => {
    const a2aTool: MindosAgentTool = {
      name: 'call_a2a_agent', label: 'A2A', description: '', parameters: {},
      execute: async () => ({ content: [], details: {} }),
    };
    const acpTool: MindosAgentTool = {
      name: 'call_acp_agent', label: 'ACP', description: '', parameters: {},
      execute: async () => ({ content: [], details: {} }),
    };
    const { host } = createFakeHost({ delegationTools: { a2a: [a2aTool], acp: [acpTool] } });
    const toolkit = createMindosKbToolkit(host);

    const chatNames = new Set(toolkit.getChatTools().map((tool) => tool.name));
    expect([...chatNames].every((name) => CHAT_TOOL_NAMES.has(name))).toBe(true);
    expect([...chatNames].some((name) => WRITE_TOOLS.has(name))).toBe(false);
    expect(chatNames.has('call_a2a_agent')).toBe(false);

    const agentNames = new Set(
      toolkit.getToolsForPolicy(createMindosAgentPermissionPolicy('agent')).map((tool) => tool.name),
    );
    expect(agentNames.has('write_file')).toBe(true);
    expect(agentNames.has('call_a2a_agent')).toBe(true);
    expect(agentNames.has('call_acp_agent')).toBe(true);

    const organizeNames = new Set(toolkit.getOrganizeTools().map((tool) => tool.name));
    expect(organizeNames.has('create_file')).toBe(true);
    expect(organizeNames.has('call_acp_agent')).toBe(false);
  });

  it('reads files through the host and reports missing files as tool errors, never throws', async () => {
    const { host, store } = createFakeHost();
    store.set('Note.md', '# Hello');
    const toolkit = createMindosKbToolkit(host);
    const readFile = toolkit.knowledgeBaseTools.find((tool) => tool.name === 'read_file');

    await expect(callTool(readFile, { path: 'Note.md' })).resolves.toContain('# Hello');
    await expect(callTool(readFile, { path: 'Ghost.md' })).resolves.toContain('Error: File not found');
  });

  it('lists the host file tree with subdirectory scoping', async () => {
    const { host, store } = createFakeHost();
    store.set('README.md', '#');
    store.set('Profile/Identity.md', '#');
    const toolkit = createMindosKbToolkit(host);
    const listFiles = toolkit.knowledgeBaseTools.find((tool) => tool.name === 'list_files');

    const all = await callTool(listFiles, {});
    expect(all).toContain('README.md');
    expect(all).toContain('Profile/');

    const scoped = await callTool(listFiles, { path: 'Profile' });
    expect(scoped).toContain('Identity.md');
    expect(scoped).not.toContain('README.md');

    await expect(callTool(listFiles, { path: 'Missing' })).resolves.toContain('Directory not found: Missing');
  });

  it('writes through the host, returns a diff summary, and records file_changed run events', async () => {
    const { host, store } = createFakeHost();
    store.set('Existing.md', 'old line');
    const toolkit = createMindosKbToolkit(host);
    const writeFile = toolkit.knowledgeBaseTools.find((tool) => tool.name === 'write_file');
    const run = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      permissionMode: 'agent',
      inputSummary: 'KB toolkit write test.',
    });

    const output = await runWithAgentRunContext(
      { rootRunId: run.id, parentRunId: run.id },
      () => callTool(writeFile, { path: 'Existing.md', content: 'new line' }),
    );

    expect(store.get('Existing.md')).toBe('new line');
    expect(output).toContain('File written: Existing.md');
    expect(output).toContain('+ new line');
    expect(output).toContain('- old line');

    const events = listAgentEvents({ runId: run.id, category: 'file' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'file_changed',
      filePath: 'Existing.md',
      data: { kind: 'file', action: 'updated', path: 'Existing.md' },
    });
  });

  it('reports lint, dreaming, and compile as unavailable when the host omits those backends', async () => {
    const { host } = createFakeHost();
    const toolkit = createMindosKbToolkit(host);
    const lint = toolkit.knowledgeBaseTools.find((tool) => tool.name === 'lint');
    const dreaming = toolkit.knowledgeBaseTools.find((tool) => tool.name === 'dreaming');
    const compile = toolkit.knowledgeBaseTools.find((tool) => tool.name === 'compile');

    await expect(callTool(lint, {})).resolves.toContain('lint tool is not available');
    await expect(callTool(dreaming, {})).resolves.toContain('dreaming tool is not available');
    await expect(callTool(compile, { space: 'Research' })).resolves.toContain('compile tool is not available');
  });

  it('renders the host lint report with score and issue sections', async () => {
    const { host } = createFakeHost({
      runLint: () => ({
        healthScore: 80,
        scope: 'full',
        stats: { totalFiles: 12 },
        orphans: [{ path: 'Orphan.md' }],
        brokenLinks: [{ source: 'A.md', line: 3, target: 'Missing' }],
        stale: [],
        empty: [],
      }),
    });
    const toolkit = createMindosKbToolkit(host);
    const lint = toolkit.knowledgeBaseTools.find((tool) => tool.name === 'lint');

    const output = await callTool(lint, {});
    expect(output).toContain('Score: 80/100');
    expect(output).toContain('Orphan.md');
    expect(output).toContain('A.md:3 → [[Missing]]');
  });

  it('runs Dreaming through the host and returns its report', async () => {
    const { host } = createFakeHost({
      runDreaming: (_mindRoot, options) => ({
        run: {
          id: 'dream-1',
          scope: options.space ?? 'all',
          lint: { healthScore: 91, stats: { totalFiles: 7 } },
          proposals: [{ type: 'review_stale_file', title: 'Review stale note' }],
        },
        report: `Dreaming scope=${options.space ?? 'all'} write=${options.writeArtifacts}`,
      }),
    });
    const toolkit = createMindosKbToolkit(host);
    const dreaming = toolkit.knowledgeBaseTools.find((tool) => tool.name === 'dreaming');

    await expect(callTool(dreaming, { space: 'Projects', dryRun: true }))
      .resolves.toBe('Dreaming scope=Projects write=false');
  });
});

describe('truncate', () => {
  it('returns short content unchanged and truncates beyond the budget', () => {
    expect(truncate('hello')).toBe('hello');
    const long = 'a'.repeat(25_000);
    const result = truncate(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('[...truncated');
  });
});
