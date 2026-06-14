"use strict";

const obsidian = require("obsidian");
const { Plugin, PluginSettingTab, Setting, Notice } = obsidian;

class CanarySettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Community Canary" });
    new Setting(containerEl)
      .setName("Runs")
      .setDesc("Number of canary executions imported from Obsidian data.json.")
      .addText((text) => text.setValue(String(this.plugin.settings.runs || 0)));
  }
}

module.exports = class CommunityCanary extends Plugin {
  async onload() {
    this.settings = Object.assign({ runs: 0, sourceVault: "unknown" }, await this.loadData());

    const tab = new CanarySettingsTab(this.app, this);
    tab.display();
    this.addSettingTab(tab);

    this.addRibbonIcon("sparkles", "Run canary", () => this.runCanary());
    this.addStatusBarItem().setText("Canary ready");

    this.registerMarkdownCodeBlockProcessor("canary", (source, el) => {
      el.createEl("p", { text: "canary:" + source.trim().toUpperCase() });
    });

    this.addCommand({
      id: "run-canary",
      name: "Run Canary",
      callback: () => this.runCanary()
    });
  }

  async runCanary() {
    const notePath = "Inbox/community-canary.md";
    let note = this.app.vault.getFileByPath(notePath);
    if (!note) {
      note = await this.app.vault.create(notePath, "# Community Canary\n");
    }

    await this.app.vault.append(note, "\n- run");
    const cache = this.app.metadataCache.getFileCache(note);
    this.settings.runs = (this.settings.runs || 0) + 1;
    this.settings.lastHeading = cache && cache.headings && cache.headings[0] ? cache.headings[0].heading : null;
    await this.saveData(this.settings);
    new Notice("Community canary ran");
  }
};
