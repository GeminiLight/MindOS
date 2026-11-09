import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production Obsidian desktop launch wiring', () => {
  it('registers a local-only entry and uses trusted current-window context', () => {
    // The IPC registrations moved out of main.ts into ipc-handlers.ts when the
    // desktop shell was split to keep files under 1000 lines. The contract is
    // about where the handler is *registered*, not which file holds it.
    const handlers = readFileSync('packages/desktop/src/ipc-handlers.ts', 'utf8');
    expect(handlers).toContain("handleLocalOnly('obsidian:open-editor'");
    expect(handlers).toContain('obsidianEditorLauncher.open(event, request)');
    expect(handlers).toContain('createObsidianEditorLauncher(');
  });
  it('exposes only plugin/file selection, not credentials or executable paths', () => {
    const preload = readFileSync('packages/desktop/src/preload.ts', 'utf8');
    expect(preload).toContain("ipcRenderer.invoke('obsidian:open-editor', { pluginId, filePath })");
  });
});
