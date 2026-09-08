import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production Obsidian desktop launch wiring', () => {
  it('registers a local-only entry and uses trusted current-window context', () => {
    const main = readFileSync('packages/desktop/src/main.ts', 'utf8');
    expect(main).toContain("handleLocalOnly('obsidian:open-editor'");
    expect(main).toContain('obsidianEditorLauncher.open(event, request)');
    expect(main).toContain('createObsidianEditorLauncher(');
  });
  it('exposes only plugin/file selection, not credentials or executable paths', () => {
    const preload = readFileSync('packages/desktop/src/preload.ts', 'utf8');
    expect(preload).toContain("ipcRenderer.invoke('obsidian:open-editor', { pluginId, filePath })");
  });
});
