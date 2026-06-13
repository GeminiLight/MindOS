/**
 * Extension entry files must load through pi's DefaultResourceLoader — the
 * SAME jiti-based path the embedded runtime uses in production. jiti resolves
 * no '@/' path alias, so a webpack-land import leaking anywhere into an
 * entry's module graph makes that entry fail to load, and the failure is
 * nearly silent: the session runs with `noTools: 'builtin'`, so a dead
 * kb-extension entry means the agent has NO KB tools at all (the write_file
 * outage found in Wave 5 runtime regression testing).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { registerWebKbExtensionHost } from '@/lib/agent/kb-extension-host';

const webAppDir = path.resolve(__dirname, '..', '..');

const ENTRIES = [
  'lib/agent/kb-extension.ts',
  'lib/agent/ask-user-question-bridge-extension.ts',
  'lib/agent/web-search-extension.ts',
  'lib/agent/subagent-ledger-extension.ts',
  'lib/im/index.ts',
  'lib/schedule-prompt/index.ts',
] as const;

describe('pi extension entries load in the production jiti module graph', () => {
  let agentDir: string;
  let loaded: Array<{ path: string; tools: Map<string, unknown> }>;
  let errors: Array<{ path: string; error: string }>;

  beforeAll(async () => {
    registerWebKbExtensionHost();
    agentDir = mkdtempSync(path.join(tmpdir(), 'mindos-ext-load-'));
    const loader = new DefaultResourceLoader({
      cwd: webAppDir,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
      systemPrompt: '',
      appendSystemPrompt: [],
      additionalSkillPaths: [],
      additionalExtensionPaths: ENTRIES.map((entry) => path.join(webAppDir, entry)),
    });
    await loader.reload();
    const result = loader.getExtensions() as {
      extensions: Array<{ path: string; tools: Map<string, unknown> }>;
      errors?: Array<{ path: string; error: string }>;
    };
    loaded = result.extensions;
    errors = result.errors ?? [];
  }, 30_000);

  afterAll(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it('loads every entry without errors', () => {
    expect(errors.map((entry) => `${path.basename(entry.path)}: ${entry.error}`)).toEqual([]);
    expect(loaded.map((extension) => path.basename(extension.path)).sort()).toEqual(
      ENTRIES.map((entry) => path.basename(entry)).sort(),
    );
  });

  it('registers the KB write tools through the loader-executed kb entry', () => {
    const kb = loaded.find((extension) => extension.path.endsWith('kb-extension.ts'));
    expect(kb).toBeDefined();
    const toolNames = [...kb!.tools.keys()];
    for (const required of ['read_file', 'write_file', 'search', 'list_files']) {
      expect(toolNames).toContain(required);
    }
  });

  it('keeps every entry file free of direct webpack-land path-alias imports', () => {
    for (const entry of ENTRIES) {
      const source = readFileSync(path.join(webAppDir, entry), 'utf-8');
      expect(source, `${entry} must not import '@/...' — jiti cannot resolve it`).not.toMatch(
        /from\s+['"]@\//,
      );
    }
  });
});
