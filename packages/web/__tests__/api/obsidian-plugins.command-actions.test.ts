import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  installObsidianPluginApiHarness,
  writePlugin,
  importLifecycleRoute,
  confirmedEnableRequest,
  postRequest,
} from './obsidian-plugin-api-test-utils';
import {
  QUICKADD_WORKFLOW_PROBE_FIXTURE,
  buildQuickAddWorkflowProbeDataJson,
} from '@/lib/obsidian-compat/quickadd-workflow-fixture';

let mindRoot: string;

describe('/api/obsidian-plugins command actions', () => {
  installObsidianPluginApiHarness((root) => {
    mindRoot = root;
  });

  it('executes a loaded plugin command through the lifecycle API', async () => {
    writePlugin(
      'command-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class CommandPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'write-note',
              name: 'Write note',
              callback: async () => {
                await this.app.vault.create('notes/from-command.md', 'created');
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('command-plugin'));
    const res = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:command-plugin:write-note' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(fs.readFileSync(path.join(mindRoot, 'notes', 'from-command.md'), 'utf-8')).toBe('created');
  });

  it('rejects unavailable checkCallback commands before executing through the lifecycle API', async () => {
    writePlugin(
      'hidden-command-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class HiddenCommandPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'hidden',
              name: 'Hidden command',
              checkCallback: async (checking) => {
                if (checking) return false;
                await this.app.vault.create('notes/should-not-exist.md', 'created');
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('hidden-command-plugin'));
    const res = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:hidden-command-plugin:hidden' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/Command is not available/);
    expect(fs.existsSync(path.join(mindRoot, 'notes', 'should-not-exist.md'))).toBe(false);
  });

  it('executes editor commands against an active Markdown file context', async () => {
    fs.mkdirSync(path.join(mindRoot, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'notes', 'current.md'), '# Current', 'utf-8');
    writePlugin(
      'editor-command-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class EditorCommandPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'append-path',
              name: 'Append path',
              editorCallback: (editor, view) => {
                editor.setValue(editor.getValue() + '\\nfrom ' + view.file.path);
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('editor-command-plugin'));

    const unavailable = await POST(postRequest({
      action: 'execute-command',
      commandId: 'obsidian:editor-command-plugin:append-path',
    }));
    expect(unavailable.status).toBe(500);
    expect(fs.readFileSync(path.join(mindRoot, 'notes', 'current.md'), 'utf-8')).toBe('# Current');

    const res = await POST(postRequest({
      action: 'execute-command',
      commandId: 'obsidian:editor-command-plugin:append-path',
      editorContext: { sourcePath: 'notes/current.md' },
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result).toMatchObject({
      workspaceOpenRequests: [],
      modalSnapshots: [],
      menuSnapshots: [],
      editorUpdates: [{ sourcePath: 'notes/current.md', changed: true }],
    });
    expect(fs.readFileSync(path.join(mindRoot, 'notes', 'current.md'), 'utf-8')).toBe('# Current\nfrom notes/current.md');
  });

  it('executes editor check commands at the end of the active Markdown file by default', async () => {
    fs.mkdirSync(path.join(mindRoot, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, 'notes', 'current.md'), 'ready', 'utf-8');
    writePlugin(
      'editor-check-command-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class EditorCheckCommandPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'finish',
              name: 'Finish',
              editorCheckCallback: (checking, editor) => {
                if (checking) return editor.getValue().includes('ready');
                editor.replaceSelection(' done');
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('editor-check-command-plugin'));
    const res = await POST(postRequest({
      action: 'execute-command',
      commandId: 'obsidian:editor-check-command-plugin:finish',
      editorContext: { sourcePath: 'notes/current.md' },
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.result.editorUpdates).toEqual([{ sourcePath: 'notes/current.md', changed: true }]);
    expect(fs.readFileSync(path.join(mindRoot, 'notes', 'current.md'), 'utf-8')).toBe('ready done');
  });

  it('returns workspace open requests from executed plugin commands', async () => {
    writePlugin(
      'open-command-plugin',
      `
        const { Plugin } = require('obsidian');
        module.exports = class OpenCommandPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-note',
              name: 'Open note',
              callback: async () => {
                await this.app.vault.create('notes/opened-from-command.md', 'created');
                await this.app.workspace.openLinkText('opened-from-command', 'notes/source.md');
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('open-command-plugin'));
    const res = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:open-command-plugin:open-note' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result).toEqual({
      workspaceOpenRequests: [{
        linktext: 'opened-from-command',
        sourcePath: 'notes/source.md',
        targetPath: 'notes/opened-from-command.md',
      }],
      modalSnapshots: [],
      menuSnapshots: [],
    });
  });

  it('runs a workflow probe through the lifecycle API and exposes refreshed audit state', async () => {
    writePlugin(
      'quickadd',
      `
        const { Plugin } = require('obsidian');
        module.exports = class QuickAddPlugin extends Plugin {
          async onload() {
            const settings = await this.loadData();
            for (const choice of settings.choices || []) {
              if (!choice.command || choice.type !== 'Capture') continue;
              this.addCommand({
                id: 'choice:' + choice.id,
                name: choice.name,
                callback: async () => {
                  const existing = this.app.vault.getFileByPath(choice.captureTo);
                  const file = existing || await this.app.vault.create(choice.captureTo, '');
                  await this.app.vault.modify(file, choice.format.format);
                }
              });
            }
          }
        };
      `,
    );
    fs.writeFileSync(
      path.join(mindRoot, '.plugins', 'quickadd', 'data.json'),
      JSON.stringify(buildQuickAddWorkflowProbeDataJson('2.13.1'), null, 2),
      'utf-8',
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('quickadd'));
    const res = await POST(postRequest({
      action: 'run-workflow-probe',
      pluginId: 'quickadd',
      probeId: 'quickadd-capture-macro',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.result).toMatchObject({
      id: 'quickadd-capture-macro',
      status: 'passed',
    });
    expect(json.plugins.find((plugin: { id: string }) => plugin.id === 'quickadd')).toMatchObject({
      workflowProbeHistory: {
        total: 1,
      },
      workflowAudits: [
        expect.objectContaining({
          id: 'quickadd-capture-macro',
          status: 'observed',
          source: 'workflow-probe',
        }),
      ],
    });
    expect(fs.readFileSync(path.join(mindRoot, QUICKADD_WORKFLOW_PROBE_FIXTURE.targetPath), 'utf-8')).toBe(QUICKADD_WORKFLOW_PROBE_FIXTURE.captureContent);
  });

  it('rejects unknown workflow probe ids as invalid requests', async () => {
    writePlugin(
      'quickadd',
      `
        const { Plugin } = require('obsidian');
        module.exports = class QuickAddPlugin extends Plugin {
          onload() {
            this.addCommand({ id: 'capture', name: 'QuickAdd Capture', callback: () => {} });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('quickadd'));
    const res = await POST(postRequest({
      action: 'run-workflow-probe',
      pluginId: 'quickadd',
      probeId: 'not-a-probe',
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Unknown workflow probe id: not-a-probe');
  });

  it('returns notice snapshots from executed plugin commands', async () => {
    writePlugin(
      'notice-command-plugin',
      `
        const { Notice, Plugin } = require('obsidian');
        module.exports = class NoticeCommandPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'save-note',
              name: 'Save note',
              callback: () => {
                new Notice('Saved note', 1500);
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('notice-command-plugin'));
    const res = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:notice-command-plugin:save-note' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result).toEqual({
      workspaceOpenRequests: [],
      modalSnapshots: [],
      menuSnapshots: [],
      noticeSnapshots: [{
        id: 'notice-command-plugin:notice:1',
        pluginId: 'notice-command-plugin',
        message: 'Saved note',
        timeout: 1500,
        level: 'success',
      }],
    });
  });

  it('returns safe modal snapshots from executed plugin commands', async () => {
    writePlugin(
      'modal-command-plugin',
      `
        const { Modal, Plugin } = require('obsidian');
        class CaptureModal extends Modal {
          onOpen() {
            this.setTitle('Quick capture');
            this.contentEl.createDiv({ text: 'Choose a template before writing.' });
          }
        }
        module.exports = class ModalCommandPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-modal',
              name: 'Open modal',
              callback: () => {
                new CaptureModal(this.app).open();
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('modal-command-plugin'));
    const res = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:modal-command-plugin:open-modal' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result.workspaceOpenRequests).toEqual([]);
    expect(json.result.modalSnapshots).toEqual([
      expect.objectContaining({
        id: 'modal-command-plugin:modal:1',
        pluginId: 'modal-command-plugin',
        kind: 'modal',
        title: 'Quick capture',
        text: 'Choose a template before writing.',
      }),
    ]);
    expect(json.result.menuSnapshots).toEqual([]);
  });
});
