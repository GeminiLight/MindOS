import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';
import {
  ObsidianWorkflowProbeStore,
  buildObsidianWorkflowProbeAudits,
} from '@/lib/obsidian-compat/workflow-probes';
import {
  QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE,
  QUICKADD_WORKFLOW_PROBE_FIXTURE,
  buildQuickAddWorkflowProbeDataJson,
} from '@/lib/obsidian-compat/quickadd-workflow-fixture';

let mindRoot: string;

const writePlugin = (pluginId: string, mainJs: string) => {
  const pluginDir = path.join(mindRoot, '.mindos', 'plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0' }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
};

const writePluginData = (pluginId: string, data: unknown) => {
  const pluginDir = path.join(mindRoot, '.mindos', 'plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'data.json'), JSON.stringify(data, null, 2), 'utf-8');
};

const writeQuickAddTemplateFixture = () => {
  const templatePath = path.join(mindRoot, QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.templatePath);
  fs.mkdirSync(path.dirname(templatePath), { recursive: true });
  fs.writeFileSync(templatePath, QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.templateContent, 'utf-8');
};

describe('Obsidian workflow probes', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-workflow-probes-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('passes the QuickAdd capture/macro probe only after a data.json choice command writes the fixture note', async () => {
    writePlugin('quickadd', `
      const { Notice, Plugin } = require('obsidian');
      module.exports = class QuickAddPlugin extends Plugin {
        async onload() {
          const settings = await this.loadData();
          this.addCommand({
            id: 'runQuickAdd',
            name: 'Run',
            callback: () => new Notice('QuickAdd picker only')
          });
          for (const choice of settings.choices || []) {
            if (!choice.command || choice.type !== 'Capture') continue;
            this.addCommand({
              id: 'choice:' + choice.id,
              name: choice.name,
              callback: async () => {
                const existing = this.app.vault.getFileByPath(choice.captureTo);
                const file = existing || await this.app.vault.create(choice.captureTo, '');
                await this.app.vault.modify(file, choice.format.format);
                new Notice('QuickAdd capture complete');
              }
            });
          }
        }
      };
    `);
    writePluginData('quickadd', buildQuickAddWorkflowProbeDataJson('2.13.1'));

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('quickadd', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('quickadd', 'quickadd-capture-macro');

    expect(result).toMatchObject({
      pluginId: 'quickadd',
      id: 'quickadd-capture-macro',
      status: 'passed',
      source: 'workflow-probe',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('Executed QuickAdd capture choice command "MindOS Capture"'),
      expect.stringContaining(QUICKADD_WORKFLOW_PROBE_FIXTURE.targetPath),
    ]));
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execute-command', passed: true }),
      expect.objectContaining({ id: 'quickadd-choice-command', passed: true }),
      expect.objectContaining({ id: 'observable-result', passed: true }),
      expect.objectContaining({ id: 'fixture-note-written', passed: true }),
      expect.objectContaining({ id: 'fixture-note-content', passed: true }),
      expect.objectContaining({ id: 'vault-write-called-ledger', passed: true }),
      expect.objectContaining({ id: 'runtime-called-ledger', passed: true }),
    ]));
    expect(fs.readFileSync(path.join(mindRoot, QUICKADD_WORKFLOW_PROBE_FIXTURE.targetPath), 'utf-8')).toBe(QUICKADD_WORKFLOW_PROBE_FIXTURE.captureContent);

    const plugin = manager.list().find((item) => item.id === 'quickadd');
    expect(plugin?.workflowProbeHistory).toMatchObject({
      total: 1,
      latestById: {
        'quickadd-capture-macro': expect.objectContaining({ status: 'passed' }),
      },
    });
    expect(plugin?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'observed',
        source: 'workflow-probe',
        lastProbeStatus: 'passed',
        lastProbedAt: result.completedAt,
      }),
    ]);
  });

  it('does not pass the QuickAdd capture/macro probe from the generic Run modal alone', async () => {
    writePlugin('quickadd', `
      const { Modal, Plugin } = require('obsidian');
      class QuickAddPicker extends Modal {
        onOpen() {
          this.setTitle('Run QuickAdd');
          this.contentEl.createDiv({ text: 'No configured choices' });
        }
      }
      module.exports = class QuickAddPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'runQuickAdd',
            name: 'Run',
            callback: () => new QuickAddPicker(this.app).open()
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('quickadd', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('quickadd', 'quickadd-capture-macro');

    expect(result).toMatchObject({
      pluginId: 'quickadd',
      id: 'quickadd-capture-macro',
      status: 'skipped',
      source: 'workflow-probe',
      failureReason: expect.stringContaining('data.json-backed choice command'),
    });
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'probe-available', passed: false }),
    ]));

    const plugin = manager.list().find((item) => item.id === 'quickadd');
    expect(plugin?.workflowProbeHistory).toMatchObject({
      total: 1,
      latestById: {
        'quickadd-capture-macro': expect.objectContaining({ status: 'skipped' }),
      },
    });
    expect(plugin?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'not-observed',
        source: 'workflow-probe',
        lastProbeStatus: 'skipped',
        lastProbedAt: result.completedAt,
      }),
    ]);
  });

  it('passes the QuickAdd template probe only after a Template choice creates the fixture note from a template file', async () => {
    writePlugin('quickadd', `
      const { Notice, Plugin } = require('obsidian');
      module.exports = class QuickAddPlugin extends Plugin {
        async onload() {
          const settings = await this.loadData();
          for (const choice of settings.choices || []) {
            if (!choice.command || choice.type !== 'Template') continue;
            this.addCommand({
              id: 'choice:' + choice.id,
              name: choice.name,
              callback: async () => {
                const template = this.app.vault.getFileByPath(choice.templatePath);
                if (!template) throw new Error('Missing template fixture: ' + choice.templatePath);
                const templateContent = await this.app.vault.cachedRead(template);
                const folder = choice.folder.enabled ? choice.folder.folders[0] : '';
                if (folder) await this.app.vault.createFolder(folder);
                const fileName = choice.fileNameFormat.enabled ? choice.fileNameFormat.format : choice.name;
                const targetPath = (folder ? folder + '/' : '') + fileName.replace(/\\.md$/i, '') + '.md';
                await this.app.vault.create(targetPath, templateContent);
                new Notice('QuickAdd template complete');
              }
            });
          }
        }
      };
    `);
    writePluginData('quickadd', buildQuickAddWorkflowProbeDataJson('2.13.1'));
    writeQuickAddTemplateFixture();

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('quickadd', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('quickadd', 'quickadd-template-note');

    expect(result).toMatchObject({
      pluginId: 'quickadd',
      id: 'quickadd-template-note',
      status: 'passed',
      source: 'workflow-probe',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('Executed QuickAdd template choice command "MindOS Template"'),
      expect.stringContaining(QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.targetPath),
    ]));
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execute-command', passed: true }),
      expect.objectContaining({ id: 'quickadd-choice-command', passed: true }),
      expect.objectContaining({ id: 'observable-result', passed: true }),
      expect.objectContaining({ id: 'fixture-template-note-written', passed: true }),
      expect.objectContaining({ id: 'fixture-template-note-content', passed: true }),
      expect.objectContaining({ id: 'vault-write-called-ledger', passed: true }),
      expect.objectContaining({ id: 'runtime-called-ledger', passed: true }),
    ]));
    expect(fs.readFileSync(path.join(mindRoot, QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.targetPath), 'utf-8'))
      .toBe(QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.templateContent);
    const plugin = manager.list().find((item) => item.id === 'quickadd');
    expect(plugin?.runtime.capabilityLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'Vault.create', phase: 'called' }),
    ]));
    expect(plugin?.workflowAudits).toEqual([
      expect.objectContaining({ id: 'quickadd-capture-macro' }),
      expect.objectContaining({
        id: 'quickadd-template-note',
        status: 'observed',
        source: 'workflow-probe',
        lastProbeStatus: 'passed',
      }),
    ]);
  });

  it('fails the QuickAdd template probe when the Template choice does not create the fixture target', async () => {
    writePlugin('quickadd', `
      const { Plugin } = require('obsidian');
      module.exports = class QuickAddPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'choice:${QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.choiceId}',
            name: '${QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.choiceName}',
            callback: async () => {
              await this.app.vault.create('Generated/wrong-template-note.md', 'wrong content');
            }
          });
        }
      };
    `);
    writePluginData('quickadd', buildQuickAddWorkflowProbeDataJson('2.13.1'));
    writeQuickAddTemplateFixture();

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('quickadd', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('quickadd', 'quickadd-template-note');

    expect(result).toMatchObject({
      id: 'quickadd-template-note',
      status: 'failed',
      failureReason: expect.stringContaining(QUICKADD_TEMPLATE_WORKFLOW_PROBE_FIXTURE.targetPath),
    });
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execute-command', passed: true }),
      expect.objectContaining({ id: 'observable-result', passed: true }),
      expect.objectContaining({ id: 'fixture-template-note-written', passed: false }),
      expect.objectContaining({ id: 'fixture-template-note-content', passed: false }),
      expect.objectContaining({ id: 'vault-write-called-ledger', passed: true }),
    ]));
  });

  it('passes the Calendar open-periodic-note probe through workspace navigation evidence', async () => {
    fs.writeFileSync(path.join(mindRoot, '2026-06-26.md'), '# Today', 'utf-8');
    writePlugin('calendar', `
      const { Plugin } = require('obsidian');
      module.exports = class CalendarPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'open-today',
            name: 'Open today',
            callback: async () => {
              await this.app.workspace.openLinkText('2026-06-26', 'Daily/source.md');
            }
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot, {
      workflowProbeStore: new ObsidianWorkflowProbeStore(mindRoot, {
        now: () => new Date('2026-06-26T09:00:00.000Z'),
      }),
    });
    await manager.discover();
    await manager.enable('calendar', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('calendar', 'calendar-open-periodic-note');

    expect(result).toMatchObject({
      id: 'calendar-open-periodic-note',
      status: 'passed',
      completedAt: '2026-06-26T09:00:00.000Z',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('workspace open request'),
    ]));
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workspace-open', passed: true }),
      expect.objectContaining({ id: 'runtime-called-ledger', passed: true }),
    ]));
  });

  it('passes the Recent Files probe after executing the command and rendering the view snapshot', async () => {
    writePlugin('recent-files-obsidian', `
      const { ItemView, Plugin } = require('obsidian');
      class RecentFilesView extends ItemView {
        getViewType() {
          return 'recent-files';
        }
        getDisplayText() {
          return 'Recent Files';
        }
        onOpen() {
          const root = createDiv({ cls: 'nav-folder mod-root' });
          if ([].contains('explorer')) {
            root.createDiv({ text: 'Explorer aliases enabled' });
          }
          root.createDiv({ text: 'Alpha.md' });
          root.createDiv({ text: 'Beta.md' });
          this.contentEl.setChildrenInPlace([root]);
        }
      }
      module.exports = class RecentFilesPlugin extends Plugin {
        onload() {
          this.registerView('recent-files', (leaf) => new RecentFilesView(leaf));
          this.addCommand({
            id: 'open-recent-files',
            name: 'Open recent files',
            callback: async () => {
              let leaf = this.app.workspace.getLeavesOfType('recent-files').first();
              if (!leaf) {
                leaf = this.app.workspace.getRightLeaf(false);
                await leaf.setViewState({ type: 'recent-files' });
              }
              await this.app.workspace.revealLeaf(leaf);
            }
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('recent-files-obsidian', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('recent-files-obsidian', 'recent-files-open-view');

    expect(result).toMatchObject({
      pluginId: 'recent-files-obsidian',
      id: 'recent-files-open-view',
      status: 'passed',
      source: 'workflow-probe',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('Executed Recent Files command "Open recent files"'),
      expect.stringContaining('Rendered Recent Files view "recent-files"'),
    ]));
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execute-command', passed: true }),
      expect.objectContaining({ id: 'render-view', passed: true }),
      expect.objectContaining({ id: 'command-called-ledger', passed: true }),
      expect.objectContaining({ id: 'view-called-ledger', passed: true }),
    ]));
    expect(manager.list().find((item) => item.id === 'recent-files-obsidian')?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'recent-files-open-view',
        status: 'observed',
        source: 'workflow-probe',
        lastProbeStatus: 'passed',
      }),
    ]);
  });

  it('skips the Recent Files probe when no view snapshot target is registered', async () => {
    writePlugin('recent-files-obsidian', `
      const { Plugin } = require('obsidian');
      module.exports = class RecentFilesPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'open-recent-files',
            name: 'Open recent files',
            callback: () => {}
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('recent-files-obsidian', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('recent-files-obsidian', 'recent-files-open-view');

    expect(result).toMatchObject({
      pluginId: 'recent-files-obsidian',
      id: 'recent-files-open-view',
      status: 'skipped',
      failureReason: expect.stringContaining('registered view'),
    });
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'probe-available', passed: false }),
    ]));
  });

  it('passes the Tag Wrangler rename probe only after fixture frontmatter and body tags are rewritten', async () => {
    writePlugin('tag-wrangler', `
      const { Plugin } = require('obsidian');
      module.exports = class TagWranglerPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'rename-tag',
            name: 'Rename Tag',
            callback: async () => {
              const oldTag = 'mindos/legacy';
              const newTag = 'mindos/renamed';
              const paths = this.app.metadataCache
                .getCachedFiles()
                .filter((filePath) => filePath.startsWith('workflow-probes/tag-wrangler/'));
              this.app.metadataCache.getTags();
              for (const filePath of paths) {
                this.app.metadataCache.getCache(filePath);
                const file = this.app.vault.getFileByPath(filePath);
                if (!file) continue;
                const markdown = await this.app.vault.read(file);
                await this.app.vault.modify(file, markdown.split(oldTag).join(newTag));
              }
            }
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('tag-wrangler', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('tag-wrangler', 'tag-wrangler-rename');

    expect(result).toMatchObject({
      pluginId: 'tag-wrangler',
      id: 'tag-wrangler-rename',
      status: 'passed',
      source: 'workflow-probe',
    });
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'frontmatter-tags-renamed', passed: true }),
      expect.objectContaining({ id: 'body-tags-renamed', passed: true }),
      expect.objectContaining({ id: 'metadata-cache-called-ledger', passed: true }),
      expect.objectContaining({ id: 'vault-write-called-ledger', passed: true }),
      expect.objectContaining({ id: 'runtime-called-ledger', passed: true }),
    ]));
    const alpha = fs.readFileSync(path.join(mindRoot, 'workflow-probes/tag-wrangler/alpha.md'), 'utf-8');
    const beta = fs.readFileSync(path.join(mindRoot, 'workflow-probes/tag-wrangler/beta.md'), 'utf-8');
    expect(alpha).toContain('mindos/renamed');
    expect(alpha).not.toContain('mindos/legacy');
    expect(beta).toContain('#mindos/renamed');
    expect(beta).not.toContain('#mindos/legacy');
    expect(manager.list().find((item) => item.id === 'tag-wrangler')?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'tag-wrangler-rename',
        status: 'observed',
        source: 'workflow-probe',
        lastProbeStatus: 'passed',
      }),
    ]);
  });

  it('passes the Tag Wrangler rename probe through an official-style editor-menu entrypoint when no command exists', async () => {
    writePlugin('tag-wrangler', `
      const { Plugin } = require('obsidian');
      module.exports = class TagWranglerMenuPlugin extends Plugin {
        onload() {
          this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
            const token = editor.getClickableTokenAt(editor.getCursor());
            if (token?.type !== 'tag') return;
            const oldTag = token.text.replace(/^#/, '');
            menu.addItem((item) => item
              .setSection('tag-rename')
              .setIcon('pencil')
              .setTitle('Rename #' + oldTag)
              .onClick(async () => {
                const newTag = 'mindos/renamed';
                const paths = this.app.metadataCache
                  .getCachedFiles()
                  .filter((filePath) => filePath.startsWith('workflow-probes/tag-wrangler/'));
                this.app.metadataCache.getTags();
                for (const filePath of paths) {
                  this.app.metadataCache.getCache(filePath);
                  const file = this.app.vault.getFileByPath(filePath);
                  if (!file) continue;
                  const markdown = await this.app.vault.read(file);
                  await this.app.vault.modify(file, markdown.split(oldTag).join(newTag));
                }
              }));
          }));
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('tag-wrangler', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('tag-wrangler', 'tag-wrangler-rename');

    expect(result).toMatchObject({
      pluginId: 'tag-wrangler',
      id: 'tag-wrangler-rename',
      status: 'passed',
      source: 'workflow-probe',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('Triggered editor-menu for #mindos/legacy'),
      expect.stringContaining('Editor menu item: Rename #mindos/legacy'),
      expect.stringContaining('Selected menu item "Rename #mindos/legacy"'),
    ]));
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'editor-menu-triggered', passed: true }),
      expect.objectContaining({ id: 'rename-menu-item-available', passed: true }),
      expect.objectContaining({ id: 'menu-item-executed', passed: true }),
      expect.objectContaining({ id: 'menu-called-ledger', passed: true }),
      expect.objectContaining({ id: 'frontmatter-tags-renamed', passed: true }),
      expect.objectContaining({ id: 'body-tags-renamed', passed: true }),
      expect.objectContaining({ id: 'metadata-cache-called-ledger', passed: true }),
      expect.objectContaining({ id: 'vault-write-called-ledger', passed: true }),
      expect.objectContaining({ id: 'runtime-called-ledger', passed: true }),
    ]));
    const plugin = manager.list().find((item) => item.id === 'tag-wrangler');
    expect(plugin?.runtime.capabilityLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'Workspace.on', phase: 'registered' }),
      expect.objectContaining({ capability: 'Workspace.editor-menu', phase: 'called' }),
      expect.objectContaining({ capability: 'Menu', phase: 'called' }),
      expect.objectContaining({ capability: 'MenuItem', phase: 'called' }),
    ]));
    expect(plugin?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'tag-wrangler-rename',
        status: 'observed',
        source: 'workflow-probe',
        lastProbeStatus: 'passed',
      }),
    ]);
  });

  it('passes the Tag Wrangler rename probe when the editor-menu entrypoint opens a text prompt', async () => {
    writePlugin('tag-wrangler', `
      const { Modal, Plugin } = require('obsidian');
      class RenameTagPrompt extends Modal {
        constructor(app, oldTag) {
          super(app);
          this.oldTag = oldTag;
        }
        onOpen() {
          this.setTitle('Renaming #' + this.oldTag + ' (and any sub-tags)');
          this.contentEl.createDiv({ text: 'Enter new name (must be a valid Obsidian tag name):' });
          this.inputEl = this.contentEl.createEl('input', { type: 'text', value: this.oldTag });
          this.okButton = this.modalEl.createEl('button', { text: 'Continue' });
          this.okButton.addEventListener('click', async () => {
            const newTag = this.inputEl.value;
            if (!newTag || newTag === this.oldTag) {
              this.close();
              return;
            }
            const paths = this.app.metadataCache
              .getCachedFiles()
              .filter((filePath) => filePath.startsWith('workflow-probes/tag-wrangler/'));
            this.app.metadataCache.getTags();
            for (const filePath of paths) {
              this.app.metadataCache.getCache(filePath);
              const file = this.app.vault.getFileByPath(filePath);
              if (!file) continue;
              const markdown = await this.app.vault.read(file);
              await this.app.vault.modify(file, markdown.split(this.oldTag).join(newTag));
            }
            this.close();
          });
        }
      }
      module.exports = class TagWranglerPromptPlugin extends Plugin {
        onload() {
          this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
            const token = editor.getClickableTokenAt(editor.getCursor());
            if (token?.type !== 'tag') return;
            const oldTag = token.text.replace(/^#/, '');
            menu.addItem((item) => item
              .setSection('tag-rename')
              .setIcon('pencil')
              .setTitle('Rename #' + oldTag)
              .onClick(() => new RenameTagPrompt(this.app, oldTag).open()));
          }));
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('tag-wrangler', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('tag-wrangler', 'tag-wrangler-rename');

    expect(result).toMatchObject({
      pluginId: 'tag-wrangler',
      id: 'tag-wrangler-rename',
      status: 'passed',
      source: 'workflow-probe',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('Triggered editor-menu for #mindos/legacy'),
      expect.stringContaining('Selected menu item "Rename #mindos/legacy"'),
      expect.stringContaining('Submitted text prompt "Renaming #mindos/legacy'),
    ]));
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'menu-item-executed', passed: true }),
      expect.objectContaining({ id: 'rename-text-prompt-submitted', passed: true }),
      expect.objectContaining({ id: 'frontmatter-tags-renamed', passed: true }),
      expect.objectContaining({ id: 'body-tags-renamed', passed: true }),
      expect.objectContaining({ id: 'metadata-cache-called-ledger', passed: true }),
      expect.objectContaining({ id: 'vault-write-called-ledger', passed: true }),
    ]));
  });

  it('passes the Admonition render probe only when plugin output aligns with the native callout snapshot', async () => {
    writePlugin('obsidian-admonition', `
      const { Plugin } = require('obsidian');
      module.exports = class AdmonitionPlugin extends Plugin {
        onload() {
          this.registerMarkdownPostProcessor((el) => {
            const code = el.querySelector('code');
            if (!code || !code.textContent.includes('MindOS workflow probe')) return;
            el.createDiv({ text: 'note\\nMindOS workflow probe' });
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('obsidian-admonition', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('obsidian-admonition', 'admonition-render-markdown');

    expect(result).toMatchObject({
      pluginId: 'obsidian-admonition',
      id: 'admonition-render-markdown',
      status: 'passed',
      source: 'workflow-probe',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('Native callout snapshot: note'),
      expect.stringContaining('Processor output: note'),
    ]));
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'render-markdown', passed: true }),
      expect.objectContaining({ id: 'native-callout-snapshot', passed: true }),
      expect.objectContaining({ id: 'plugin-native-snapshot-alignment', passed: true }),
      expect.objectContaining({ id: 'runtime-called-ledger', passed: true }),
    ]));
    expect(manager.list().find((item) => item.id === 'obsidian-admonition')?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'admonition-render-markdown',
        status: 'observed',
        source: 'workflow-probe',
        lastProbeStatus: 'passed',
      }),
    ]);
  });

  it('fails the QuickAdd probe when the configured choice command does not write the fixture note', async () => {
    writePlugin('quickadd', `
      const { Plugin } = require('obsidian');
      module.exports = class QuickAddPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'choice:${QUICKADD_WORKFLOW_PROBE_FIXTURE.choiceId}',
            name: '${QUICKADD_WORKFLOW_PROBE_FIXTURE.choiceName}',
            callback: () => {}
          });
        }
      };
    `);
    writePluginData('quickadd', buildQuickAddWorkflowProbeDataJson('2.13.1'));

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('quickadd', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('quickadd', 'quickadd-capture-macro');

    expect(result).toMatchObject({
      id: 'quickadd-capture-macro',
      status: 'failed',
      failureReason: expect.stringContaining('did not change any public vault file'),
    });
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execute-command', passed: true }),
      expect.objectContaining({ id: 'observable-result', passed: false }),
      expect.objectContaining({ id: 'fixture-note-written', passed: false }),
      expect.objectContaining({ id: 'fixture-note-content', passed: false }),
    ]));
    expect(manager.list().find((item) => item.id === 'quickadd')?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'partial',
        source: 'workflow-probe',
        lastProbeStatus: 'failed',
        probeFailureReason: expect.stringContaining('did not change any public vault file'),
      }),
    ]);
  });

  it('keeps probe history across manager restarts and summarizes latest results by workflow', async () => {
    writePlugin('calendar', `
      const { Plugin } = require('obsidian');
      module.exports = class CalendarPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'open-today',
            name: 'Open today',
            callback: async () => {
              await this.app.workspace.openLinkText('missing-note', '');
            }
          });
        }
      };
    `);

    const first = new PluginManager(mindRoot);
    await first.discover();
    await first.enable('calendar', { confirmCapabilityGate: true });
    await first.runWorkflowProbe('calendar', 'calendar-open-periodic-note');

    const restarted = new PluginManager(mindRoot);
    await restarted.discover();
    const plugin = restarted.list().find((item) => item.id === 'calendar');

    expect(plugin?.workflowProbeHistory).toMatchObject({
      total: 1,
      latestById: {
        'calendar-open-periodic-note': expect.objectContaining({
          pluginId: 'calendar',
          id: 'calendar-open-periodic-note',
          status: 'passed',
        }),
      },
    });
    expect(buildObsidianWorkflowProbeAudits(plugin?.workflowProbeHistory).map((item) => item.id)).toEqual([
      'calendar-open-periodic-note',
    ]);
  });
});
