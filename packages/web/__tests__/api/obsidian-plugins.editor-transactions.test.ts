import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  installObsidianPluginApiHarness, writePlugin, importLifecycleRoute,
  confirmedEnableRequest, postRequest,
} from './obsidian-plugin-api-test-utils';

let mindRoot: string;

describe('Obsidian editor transaction command lifecycle', () => {
  installObsidianPluginApiHarness(root => { mindRoot = root; });

  async function execute(body: string) {
    fs.writeFileSync(path.join(mindRoot, 'note.md'), 'one\ntwo\nthree');
    writePlugin('text-transactions', `
      const { Plugin } = require('obsidian');
      module.exports = class extends Plugin {
        onload() {
          this.addCommand({ id: 'edit', name: 'Edit', editorCallback(editor) { ${body} } });
        }
      };
    `);
    const { POST } = await importLifecycleRoute();
    expect((await POST(confirmedEnableRequest('text-transactions'))).status).toBe(200);
    return POST(postRequest({
      action: 'execute-command', commandId: 'obsidian:text-transactions:edit',
      editorContext: { sourcePath: 'note.md' },
    }));
  }

  it('persists a multi-change plugin transaction through the installed package loader and command API', async () => {
    const result = await execute(`
      editor.transaction({ changes: [
        { from: { line: 2, ch: 0 }, to: { line: 2, ch: 5 }, text: 'THREE!' },
        { from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 }, text: '1' },
      ] });
      editor.undo();
      editor.redo();
    `);
    expect(result.status).toBe(200);
    expect((await result.json()).result.editorUpdates).toEqual([{ sourcePath: 'note.md', changed: true }]);
    expect(fs.readFileSync(path.join(mindRoot, 'note.md'), 'utf8')).toBe('1\ntwo\nTHREE!');
  });

  it('does not write a plugin edit that was undone before the command completed', async () => {
    const result = await execute("editor.replaceSelection('changed'); editor.undo();");
    expect(result.status).toBe(200);
    expect((await result.json()).result.editorUpdates).toBeUndefined();
    expect(fs.readFileSync(path.join(mindRoot, 'note.md'), 'utf8')).toBe('one\ntwo\nthree');
  });

  it('leaves the vault unchanged when a transaction fails after an earlier buffered edit', async () => {
    const result = await execute(`
      editor.replaceSelection('buffered');
      editor.transaction({ changes: [{ from: { line: 0, ch: 0 }, text: 'X' }], selections: [] });
    `);
    expect(result.status).toBe(500);
    expect((await result.json()).error).toMatch(/At least one editor selection/);
    expect(fs.readFileSync(path.join(mindRoot, 'note.md'), 'utf8')).toBe('one\ntwo\nthree');
  });
});
