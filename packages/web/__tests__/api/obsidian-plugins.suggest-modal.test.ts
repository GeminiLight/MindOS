import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PLUGIN_INTERACTION_TTL_MS } from '@/lib/obsidian-compat/runtime';
import {
  installObsidianPluginApiHarness,
  writePlugin,
  importLifecycleRoute,
  confirmedEnableRequest,
  postRequest,
} from './obsidian-plugin-api-test-utils';

let mindRoot: string;

describe('/api/obsidian-plugins suggest modal interactions', () => {
  installObsidianPluginApiHarness((root) => {
    mindRoot = root;
  });

  it('returns safe SuggestModal previews from executed plugin commands', async () => {
    writePlugin(
      'suggest-command-plugin',
      `
        const { Plugin, SuggestModal } = require('obsidian');
        class TemplateSuggestModal extends SuggestModal {
          constructor(app) {
            super(app);
            this.calls = 0;
          }
          onOpen() {
            this.setTitle('Select template');
            this.setPlaceholder('Template name');
            this.contentEl.createDiv({ text: 'Pick a capture template.' });
          }
          getSuggestions() {
            this.calls += 1;
            return this.calls === 1
              ? ['Inbox note', 'Daily note', 'Project note']
              : ['Changed inbox', 'Changed daily', 'Changed project'];
          }
          renderSuggestion(value, el) {
            el.createDiv({ text: 'Template: ' + value });
          }
        }
        module.exports = class SuggestCommandPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-suggest',
              name: 'Open suggest',
              callback: () => {
                new TemplateSuggestModal(this.app).open();
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('suggest-command-plugin'));
    const res = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:suggest-command-plugin:open-suggest' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result.modalSnapshots).toEqual([
      expect.objectContaining({
        id: 'suggest-command-plugin:modal:1',
        pluginId: 'suggest-command-plugin',
        kind: 'suggest',
        title: 'Select template',
        text: 'Pick a capture template.',
        placeholder: 'Template name',
        suggestions: [
          { index: 0, label: 'Template: Inbox note' },
          { index: 1, label: 'Template: Daily note' },
          { index: 2, label: 'Template: Project note' },
        ],
      }),
    ]);
    expect(json.result.modalSnapshots[0]).not.toHaveProperty('interactionId');
    expect(json.result.menuSnapshots).toEqual([]);
  });

  it('continues a SuggestModal by choosing a recorded suggestion', async () => {
    fs.writeFileSync(path.join(mindRoot, 'chosen.md'), '# Chosen\n', 'utf-8');
    writePlugin(
      'suggest-choice-plugin',
      `
        const { Notice, Plugin, SuggestModal } = require('obsidian');
        class TemplateSuggestModal extends SuggestModal {
          constructor(app) {
            super(app);
            this.calls = 0;
          }
          onOpen() {
            this.setTitle('Select template');
            this.setPlaceholder('Template name');
            this.contentEl.createDiv({ text: 'Pick a capture template.' });
          }
          getSuggestions() {
            this.calls += 1;
            return this.calls === 1
              ? ['Inbox note', 'Daily note', 'Project note']
              : ['Changed inbox', 'Changed daily', 'Changed project'];
          }
          renderSuggestion(value, el) {
            el.createDiv({ text: 'Template: ' + value });
          }
          async onChooseSuggestion(value) {
            new Notice('Selected ' + value, 1200);
            await this.app.workspace.openLinkText('chosen.md', '');
          }
        }
        module.exports = class SuggestChoicePlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-suggest',
              name: 'Open suggest',
              callback: () => {
                new TemplateSuggestModal(this.app).open();
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('suggest-choice-plugin'));
    const openRes = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:suggest-choice-plugin:open-suggest' }));
    const openJson = await openRes.json();
    const modalId = openJson.result.modalSnapshots[0].id;
    const interactionId = openJson.result.modalSnapshots[0].interactionId;
    expect(interactionId).toEqual(expect.any(String));

    const chooseRes = await POST(postRequest({
      action: 'choose-modal-suggestion',
      modalId,
      suggestionIndex: 1,
      interactionId,
    }));
    const chooseJson = await chooseRes.json();

    expect(chooseRes.status).toBe(200);
    expect(chooseJson.ok).toBe(true);
    expect(chooseJson.result).toEqual({
      workspaceOpenRequests: [{
        linktext: 'chosen.md',
        sourcePath: '',
        targetPath: 'chosen.md',
      }],
      modalSnapshots: [],
      menuSnapshots: [],
      noticeSnapshots: [{
        id: 'suggest-choice-plugin:notice:1',
        pluginId: 'suggest-choice-plugin',
        message: 'Selected Daily note',
        timeout: 1200,
        level: 'info',
      }],
    });
  });

  it('rejects stale SuggestModal interaction ids without executing the callback', async () => {
    writePlugin(
      'stale-suggest-plugin',
      `
        const { Plugin, SuggestModal } = require('obsidian');
        class TemplateSuggestModal extends SuggestModal {
          getSuggestions() {
            return ['Inbox note', 'Daily note'];
          }
          onChooseSuggestion(value) {
            this.app.vault.create('should-not-run.md', value);
          }
        }
        module.exports = class StaleSuggestPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-suggest',
              name: 'Open suggest',
              callback: () => {
                new TemplateSuggestModal(this.app).open();
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('stale-suggest-plugin'));
    const openRes = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:stale-suggest-plugin:open-suggest' }));
    const openJson = await openRes.json();
    const modal = openJson.result.modalSnapshots[0];

    const res = await POST(postRequest({
      action: 'choose-modal-suggestion',
      modalId: modal.id,
      suggestionIndex: 1,
      interactionId: 'expired-interaction',
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Expired plugin modal interaction');
    expect(fs.existsSync(path.join(mindRoot, 'should-not-run.md'))).toBe(false);
  });

  it('expires SuggestModal continuation tokens without executing the callback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-14T00:00:00.000Z'));
    writePlugin(
      'ttl-suggest-plugin',
      `
        const { Plugin, SuggestModal } = require('obsidian');
        class TemplateSuggestModal extends SuggestModal {
          getSuggestions() {
            return ['Inbox note', 'Daily note'];
          }
          onChooseSuggestion(value) {
            this.app.vault.create('ttl-suggest-ran.md', value);
          }
        }
        module.exports = class TtlSuggestPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-suggest',
              name: 'Open suggest',
              callback: () => {
                new TemplateSuggestModal(this.app).open();
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('ttl-suggest-plugin'));
    const openRes = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:ttl-suggest-plugin:open-suggest' }));
    const openJson = await openRes.json();
    const modal = openJson.result.modalSnapshots[0];
    expect(modal.interactionId).toEqual(expect.any(String));

    vi.setSystemTime(new Date(Date.now() + PLUGIN_INTERACTION_TTL_MS));
    const res = await POST(postRequest({
      action: 'choose-modal-suggestion',
      modalId: modal.id,
      suggestionIndex: 0,
      interactionId: modal.interactionId,
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Expired plugin modal interaction');
    expect(fs.existsSync(path.join(mindRoot, 'ttl-suggest-ran.md'))).toBe(false);
  });

  it('consumes SuggestModal interactions before executing callbacks so failed callbacks cannot be replayed', async () => {
    writePlugin(
      'suggest-replay-plugin',
      `
        const { Plugin, SuggestModal } = require('obsidian');
        class TemplateSuggestModal extends SuggestModal {
          getSuggestions() {
            return ['A', 'B'];
          }
          async onChooseSuggestion(value) {
            await this.app.vault.adapter.append('suggest-replay.log', value);
            throw new Error('suggest callback failed');
          }
        }
        module.exports = class SuggestReplayPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-suggest',
              name: 'Open suggest',
              callback: () => {
                new TemplateSuggestModal(this.app).open();
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('suggest-replay-plugin'));
    const openRes = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:suggest-replay-plugin:open-suggest' }));
    const openJson = await openRes.json();
    const modal = openJson.result.modalSnapshots[0];

    const firstRes = await POST(postRequest({
      action: 'choose-modal-suggestion',
      modalId: modal.id,
      suggestionIndex: 0,
      interactionId: modal.interactionId,
    }));
    const firstJson = await firstRes.json();

    expect(firstRes.status).toBe(500);
    expect(firstJson.error).toContain('suggest callback failed');
    expect(fs.readFileSync(path.join(mindRoot, 'suggest-replay.log'), 'utf-8')).toBe('A');

    const secondRes = await POST(postRequest({
      action: 'choose-modal-suggestion',
      modalId: modal.id,
      suggestionIndex: 0,
      interactionId: modal.interactionId,
    }));
    const secondJson = await secondRes.json();

    expect(secondRes.status).toBe(400);
    expect(secondJson.error).toContain('Expired plugin modal interaction');
    expect(fs.readFileSync(path.join(mindRoot, 'suggest-replay.log'), 'utf-8')).toBe('A');
  });

  it('commits editor updates made after choosing a SuggestModal suggestion', async () => {
    fs.writeFileSync(path.join(mindRoot, 'draft.md'), 'Start ', 'utf-8');
    writePlugin(
      'suggest-editor-choice-plugin',
      `
        const { Notice, Plugin, SuggestModal } = require('obsidian');
        class TemplateSuggestModal extends SuggestModal {
          constructor(app, editor) {
            super(app);
            this.editor = editor;
          }
          onOpen() {
            this.setTitle('Insert template');
            this.setPlaceholder('Template name');
          }
          getSuggestions() {
            return ['Inbox note', 'Daily note'];
          }
          renderSuggestion(value, el) {
            el.createDiv({ text: value });
          }
          onChooseSuggestion(value) {
            this.editor.replaceSelection(value);
            new Notice('Inserted ' + value, 1200);
          }
        }
        module.exports = class SuggestEditorChoicePlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'insert-template',
              name: 'Insert template',
              editorCallback: (editor) => {
                new TemplateSuggestModal(this.app, editor).open();
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('suggest-editor-choice-plugin'));
    const openRes = await POST(postRequest({
      action: 'execute-command',
      commandId: 'obsidian:suggest-editor-choice-plugin:insert-template',
      editorContext: {
        sourcePath: 'draft.md',
        cursorOffset: 'Start '.length,
      },
    }));
    const openJson = await openRes.json();
    const modal = openJson.result.modalSnapshots[0];

    const chooseRes = await POST(postRequest({
      action: 'choose-modal-suggestion',
      modalId: modal.id,
      suggestionIndex: 1,
      interactionId: modal.interactionId,
    }));
    const chooseJson = await chooseRes.json();

    expect(chooseRes.status).toBe(200);
    expect(chooseJson.ok).toBe(true);
    expect(fs.readFileSync(path.join(mindRoot, 'draft.md'), 'utf-8')).toBe('Start Daily note');
    expect(chooseJson.result.editorUpdates).toEqual([{
      sourcePath: 'draft.md',
      changed: true,
    }]);
    expect(chooseJson.result.noticeSnapshots).toEqual([{
      id: 'suggest-editor-choice-plugin:notice:1',
      pluginId: 'suggest-editor-choice-plugin',
      message: 'Inserted Daily note',
      timeout: 1200,
      level: 'info',
    }]);
  });

  it('returns SuggestModal preview errors without failing the action', async () => {
    writePlugin(
      'suggest-error-plugin',
      `
        const { Plugin, SuggestModal } = require('obsidian');
        class FailingSuggestModal extends SuggestModal {
          onOpen() {
            this.setTitle('Broken picker');
          }
          getSuggestions() {
            throw new Error('Suggestion backend unavailable');
          }
        }
        module.exports = class SuggestErrorPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'open-suggest',
              name: 'Open suggest',
              callback: () => {
                new FailingSuggestModal(this.app).open();
              }
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('suggest-error-plugin'));
    const res = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:suggest-error-plugin:open-suggest' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result.modalSnapshots).toEqual([
      expect.objectContaining({
        pluginId: 'suggest-error-plugin',
        kind: 'suggest',
        title: 'Broken picker',
        suggestions: [],
        suggestionError: 'Suggestion backend unavailable',
      }),
    ]);
    expect(json.result.menuSnapshots).toEqual([]);
  });

  it('continues a text Modal by submitting the recorded input value', async () => {
    fs.writeFileSync(path.join(mindRoot, 'rename-target.md'), '#mindos/legacy\n', 'utf-8');
    writePlugin(
      'text-modal-plugin',
      `
        const { Modal, Notice, Plugin } = require('obsidian');
        class RenamePrompt extends Modal {
          onOpen() {
            this.setTitle('Rename tag');
            this.contentEl.createDiv({ text: 'Enter a new tag name.' });
            this.inputEl = this.contentEl.createEl('input', { type: 'text', value: 'mindos/legacy' });
            this.okButton = this.modalEl.createEl('button', { text: 'Rename' });
            this.okButton.addEventListener('click', async () => {
              const file = this.app.vault.getFileByPath('rename-target.md');
              const markdown = await this.app.vault.read(file);
              await this.app.vault.modify(file, markdown.replace('mindos/legacy', this.inputEl.value));
              new Notice('Renamed tag');
              this.close();
            });
          }
        }
        module.exports = class TextModalPlugin extends Plugin {
          onload() {
            this.addCommand({
              id: 'rename-tag',
              name: 'Rename tag',
              callback: () => new RenamePrompt(this.app).open()
            });
          }
        };
      `,
    );

    const { POST } = await importLifecycleRoute();
    await POST(confirmedEnableRequest('text-modal-plugin'));
    const openRes = await POST(postRequest({ action: 'execute-command', commandId: 'obsidian:text-modal-plugin:rename-tag' }));
    const openJson = await openRes.json();
    const modal = openJson.result.modalSnapshots[0];

    expect(openRes.status).toBe(200);
    expect(modal).toEqual(expect.objectContaining({
      id: 'text-modal-plugin:modal:1',
      pluginId: 'text-modal-plugin',
      kind: 'modal',
      title: 'Rename tag',
      text: 'Enter a new tag name.',
      textInput: {
        value: 'mindos/legacy',
      },
      interactionId: expect.any(String),
    }));

    const submitRes = await POST(postRequest({
      action: 'submit-modal-text',
      modalId: modal.id,
      text: 'mindos/renamed',
      interactionId: modal.interactionId,
    }));
    const submitJson = await submitRes.json();

    expect(submitRes.status).toBe(200);
    expect(submitJson.ok).toBe(true);
    expect(fs.readFileSync(path.join(mindRoot, 'rename-target.md'), 'utf-8')).toBe('#mindos/renamed\n');
    expect(submitJson.result).toEqual({
      workspaceOpenRequests: [],
      modalSnapshots: [],
      menuSnapshots: [],
      noticeSnapshots: [{
        id: 'text-modal-plugin:notice:1',
        pluginId: 'text-modal-plugin',
        message: 'Renamed tag',
        timeout: undefined,
        level: 'info',
      }],
    });
  });
});
