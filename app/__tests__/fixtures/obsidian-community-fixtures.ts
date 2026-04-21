export interface ObsidianCommunityFixture {
  pluginId: string;
  displayName: string;
  source: string;
  code: string;
  styles?: string;
  expectedCompatibilityLevel: 'compatible' | 'partial' | 'blocked';
}

export const OBSIDIAN_COMMUNITY_FIXTURES: ObsidianCommunityFixture[] = [
  {
    pluginId: 'style-settings-like',
    displayName: 'Style Settings-like',
    source: 'https://github.com/obsidian-community/obsidian-style-settings',
    expectedCompatibilityLevel: 'compatible',
    styles: '.theme-accent { color: var(--amber); }',
    code: `
      const { Plugin, PluginSettingTab, Setting } = require('obsidian');
      class StyleSettingsTab extends PluginSettingTab {
        display() {
          const { containerEl } = this;
          containerEl.empty();
          containerEl.createEl('h2', { text: 'Style Settings' });

          new Setting(containerEl)
            .setName('Theme accent')
            .setDesc('Choose your accent color')
            .addDropdown((dropdown) => {
              dropdown
                .addOption('amber', 'Amber')
                .addOption('blue', 'Blue')
                .setValue(this.plugin.settings.accentColor || 'amber')
                .onChange(async (value) => {
                  this.plugin.settings.accentColor = value;
                  await this.plugin.saveSettings();
                });
            });

          new Setting(containerEl)
            .setName('Enable custom CSS')
            .addToggle((toggle) => {
              toggle
                .setValue(this.plugin.settings.enableCustomCSS || false)
                .onChange(async (value) => {
                  this.plugin.settings.enableCustomCSS = value;
                  await this.plugin.saveSettings();
                });
            });
        }
      }
      module.exports = class StyleSettingsLike extends Plugin {
        async onload() {
          await this.loadSettings();
          this.addSettingTab(new StyleSettingsTab(this.app, this));
        }

        async loadSettings() {
          this.settings = Object.assign({}, { accentColor: 'amber', enableCustomCSS: false }, await this.loadData());
        }

        async saveSettings() {
          await this.saveData(this.settings);
        }
      };
    `,
  },
  {
    pluginId: 'quickadd-like',
    displayName: 'QuickAdd-like',
    source: 'https://publish.obsidian.md/quickadd/ManualInstallation',
    expectedCompatibilityLevel: 'compatible',
    code: `
      const { Plugin, Modal, Notice, Setting } = require('obsidian');

      class CaptureModal extends Modal {
        constructor(app, onSubmit) {
          super(app);
          this.onSubmit = onSubmit;
        }

        onOpen() {
          const { contentEl } = this;
          contentEl.createEl('h2', { text: 'Quick Capture' });

          new Setting(contentEl)
            .setName('Note content')
            .addText((text) => {
              text.onChange((value) => {
                this.value = value;
              });
            });

          new Setting(contentEl)
            .addButton((btn) => {
              btn
                .setButtonText('Capture')
                .setCta()
                .onClick(() => {
                  this.close();
                  this.onSubmit(this.value);
                });
            });
        }

        onClose() {
          const { contentEl } = this;
          contentEl.empty();
        }
      }

      module.exports = class QuickAddLike extends Plugin {
        async onload() {
          await this.loadSettings();

          this.addCommand({
            id: 'capture',
            name: 'Quick Capture',
            callback: () => {
              new CaptureModal(this.app, (value) => {
                if (value) {
                  this.captureNote(value);
                  new Notice('Note captured!');
                } else {
                  new Notice('Capture cancelled');
                }
              }).open();
            }
          });

          this.addCommand({
            id: 'capture-to-daily',
            name: 'Capture to Daily Note',
            callback: async () => {
              try {
                const dailyNote = await this.getDailyNote();
                await this.app.vault.append(dailyNote, '\\n- Quick note');
                new Notice('Added to daily note');
              } catch (err) {
                new Notice('Failed to capture: ' + err.message);
              }
            }
          });
        }

        async loadSettings() {
          this.settings = Object.assign({}, { macros: [] }, await this.loadData());
        }

        async captureNote(content) {
          this.settings.macros.push({ content, timestamp: Date.now() });
          await this.saveData(this.settings);
        }

        async getDailyNote() {
          const today = new Date().toISOString().split('T')[0];
          const dailyPath = 'daily/' + today + '.md';
          let file = this.app.vault.getFileByPath(dailyPath);
          if (!file) {
            file = await this.app.vault.create(dailyPath, '# ' + today);
          }
          return file;
        }
      };
    `,
  },
  {
    pluginId: 'tag-wrangler-like',
    displayName: 'Tag Wrangler-like',
    source: 'https://publish.obsidian.md/hub/02+-+Community+Expansions/02.05+All+Community+Expansions/Plugins/tag-wrangler',
    expectedCompatibilityLevel: 'compatible',
    code: `
      const { Plugin, Notice, Modal, Setting } = require('obsidian');

      class RenameTagModal extends Modal {
        constructor(app, oldTag, onSubmit) {
          super(app);
          this.oldTag = oldTag;
          this.onSubmit = onSubmit;
        }

        onOpen() {
          const { contentEl } = this;
          contentEl.createEl('h2', { text: 'Rename Tag' });

          new Setting(contentEl)
            .setName('Old tag')
            .addText((text) => {
              text.setValue(this.oldTag).setDisabled(true);
            });

          new Setting(contentEl)
            .setName('New tag')
            .addText((text) => {
              text.onChange((value) => {
                this.newTag = value;
              });
            });

          new Setting(contentEl)
            .addButton((btn) => {
              btn
                .setButtonText('Rename')
                .setCta()
                .onClick(() => {
                  this.close();
                  this.onSubmit(this.newTag);
                });
            });
        }

        onClose() {
          const { contentEl } = this;
          contentEl.empty();
        }
      }

      module.exports = class TagWranglerLike extends Plugin {
        onload() {
          this.addCommand({
            id: 'rename-tag',
            name: 'Rename Tag',
            callback: () => {
              new RenameTagModal(this.app, '#old-tag', async (newTag) => {
                if (newTag) {
                  await this.renameTag('#old-tag', newTag);
                  new Notice('Tag renamed successfully');
                }
              }).open();
            }
          });

          this.addCommand({
            id: 'search-tag',
            name: 'Search Tag',
            callback: () => {
              const files = this.app.vault.getMarkdownFiles();
              let count = 0;

              for (const file of files) {
                const cache = this.app.metadataCache.getFileCache(file);
                if (cache?.tags?.some(t => t.tag === '#important')) {
                  count++;
                }
              }

              new Notice(\`Found \${count} files with #important\`);
            }
          });
        }

        async renameTag(oldTag, newTag) {
          const files = this.app.vault.getMarkdownFiles();

          for (const file of files) {
            const content = await this.app.vault.read(file);
            if (content.includes(oldTag)) {
              const newContent = content.replace(new RegExp(oldTag, 'g'), newTag);
              await this.app.vault.modify(file, newContent);
            }
          }
        }
      };
    `,
  },
  {
    pluginId: 'homepage-like',
    displayName: 'Homepage-like',
    source: 'https://www.obsidianstats.com/plugins/homepage',
    expectedCompatibilityLevel: 'compatible',
    code: `
      const { Plugin, PluginSettingTab, Setting } = require('obsidian');

      class HomepageSettingTab extends PluginSettingTab {
        display() {
          const { containerEl } = this;
          containerEl.empty();

          new Setting(containerEl)
            .setName('Homepage path')
            .setDesc('Path to your homepage note')
            .addText((text) => {
              text
                .setPlaceholder('Home.md')
                .setValue(this.plugin.settings.homepagePath || '')
                .onChange(async (value) => {
                  this.plugin.settings.homepagePath = value;
                  await this.plugin.saveSettings();
                });
            });

          new Setting(containerEl)
            .setName('Open on startup')
            .addToggle((toggle) => {
              toggle
                .setValue(this.plugin.settings.openOnStartup || false)
                .onChange(async (value) => {
                  this.plugin.settings.openOnStartup = value;
                  await this.plugin.saveSettings();
                });
            });
        }
      }

      module.exports = class HomepageLike extends Plugin {
        async onload() {
          await this.loadSettings();

          this.addSettingTab(new HomepageSettingTab(this.app, this));

          this.addCommand({
            id: 'open-homepage',
            name: 'Open Homepage',
            callback: () => {
              const path = this.settings.homepagePath || 'Home';
              this.app.workspace.openLinkText(path, '');
            }
          });

          if (this.settings.openOnStartup) {
            this.app.workspace.onLayoutReady(() => {
              const path = this.settings.homepagePath || 'Home';
              this.app.workspace.openLinkText(path, '');
            });
          }
        }

        async loadSettings() {
          this.settings = Object.assign({}, { homepagePath: 'Home', openOnStartup: false }, await this.loadData());
        }

        async saveSettings() {
          await this.saveData(this.settings);
        }
      };
    `,
  },
];
