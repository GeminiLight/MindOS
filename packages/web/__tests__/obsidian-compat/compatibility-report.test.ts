import { describe, expect, it } from 'vitest';
import {
  analyzePluginCompatibility,
  getCompatibilityLevel,
} from '@/lib/obsidian-compat/compatibility-report';

describe('compatibility report', () => {
  it('detects high-frequency supported Obsidian APIs', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin, Notice, Modal, PluginSettingTab, Setting } = require('obsidian');
      module.exports = class Example extends Plugin {
        async onload() {
          new Notice('loaded');
          this.addCommand({ id: 'test', name: 'Test', callback: () => {} });
          this.registerMarkdownPostProcessor(() => {});
        }
      }
    `);

    expect(report.obsidianApis).toEqual(
      expect.arrayContaining([
        'Plugin',
        'Notice',
        'Modal',
        'PluginSettingTab',
        'Setting',
        'addCommand',
        'registerMarkdownPostProcessor',
      ]),
    );
    expect(report.nodeModules).toEqual([]);
  });

  it('detects unsupported Node and Electron runtime dependencies', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin } = require('obsidian');
      const fs = require('fs');
      const electron = require('electron');
      module.exports = class Example extends Plugin {}
    `);

    expect(report.nodeModules).toEqual(expect.arrayContaining(['fs', 'electron']));
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/fs/),
        expect.stringMatching(/electron/),
      ]),
    );
    expect(getCompatibilityLevel(report)).toBe('blocked');
  });

  it('classifies partially supported advanced APIs as partial compatibility', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin, ItemView } = require('obsidian');
      module.exports = class Example extends Plugin {
        onload() {
          this.registerView('calendar', () => new ItemView());
          this.registerEditorExtension([]);
        }
      }
    `);

    expect(report.obsidianApis).toEqual(
      expect.arrayContaining(['ItemView', 'registerView', 'registerEditorExtension']),
    );
    expect(report.partialApis).toEqual(
      expect.arrayContaining(['ItemView', 'registerView', 'registerEditorExtension']),
    );
    expect(getCompatibilityLevel(report)).toBe('partial');
  });

  it('classifies simple command and metadata plugins as compatible', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin } = require('obsidian');
      module.exports = class Example extends Plugin {
        async onload() {
          await this.loadData();
          this.addCommand({ id: 'hello', name: 'Hello', callback: () => {} });
          this.app.metadataCache.getCache('notes/example.md');
        }
      }
    `);

    expect(report.obsidianApis).toEqual(
      expect.arrayContaining(['Plugin', 'loadData', 'addCommand', 'MetadataCache.getCache']),
    );
    expect(report.blockers).toEqual([]);
    expect(getCompatibilityLevel(report)).toBe('compatible');
  });
});
