import { describe, expect, it } from 'vitest';
import {
  analyzePluginCompatibility,
  getCompatibilityLevel,
} from '@/lib/obsidian-compat/compatibility-report';

describe('compatibility report', () => {
  it('detects high-frequency Obsidian APIs and preserves host-boundary levels', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin, Notice, Modal, PluginSettingTab, Setting, MarkdownRenderer } = require('obsidian');
      module.exports = class Example extends Plugin {
        async onload() {
          new Notice('loaded');
          this.addCommand({ id: 'test', name: 'Test', callback: () => {} });
          this.registerMarkdownPostProcessor(() => {});
          await MarkdownRenderer.renderMarkdown('# Heading', document.createElement('div'), 'notes/today.md');
          await this.app.vault.adapter.read('notes/today.md');
          await this.app.vault.process(this.app.vault.getFileByPath('notes/today.md'), (data) => data);
          this.app.vault.getResourcePath(this.app.vault.getFileByPath('assets/image.png'));
          await this.app.vault.appendBinary(this.app.vault.getFileByPath('assets/blob.bin'), new ArrayBuffer(0));
          await this.app.vault.trash(this.app.vault.getFileByPath('notes/old.md'), true);
          await this.app.fileManager.processFrontMatter(this.app.vault.getFileByPath('notes/today.md'), () => {});
          this.app.fileManager.generateMarkdownLink(this.app.vault.getFileByPath('notes/today.md'), 'notes/source.md');
          await this.app.fileManager.getAvailablePathForAttachment('image.png', 'notes/source.md');
          await this.app.fileManager.promptForDeletion(this.app.vault.getFileByPath('notes/old.md'));
          await this.app.fileManager.trashFile(this.app.vault.getFileByPath('notes/old.md'));
          this.app.workspace.getActiveViewOfType(MarkdownView);
          this.app.workspace.iterateAllLeaves(() => {});
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
        'MarkdownRenderer',
        'addCommand',
        'registerMarkdownPostProcessor',
        'Vault.adapter',
        'Vault.process',
        'Vault.getResourcePath',
        'Vault.appendBinary',
        'Vault.trash',
        'FileManager.processFrontMatter',
        'FileManager.generateMarkdownLink',
        'FileManager.getAvailablePathForAttachment',
        'FileManager.promptForDeletion',
        'FileManager.trashFile',
        'Workspace.getActiveViewOfType',
        'Workspace.iterateAllLeaves',
      ]),
    );
    expect(report.supportedApis).toEqual(expect.arrayContaining([
      'FileManager.processFrontMatter',
      'FileManager.generateMarkdownLink',
      'FileManager.getAvailablePathForAttachment',
      'FileManager.trashFile',
      'Vault.process',
      'Vault.getResourcePath',
      'Vault.appendBinary',
      'Vault.trash',
    ]));
    expect(report.partialApis).toEqual(expect.arrayContaining([
      'MarkdownRenderer',
      'Vault.adapter',
      'FileManager.promptForDeletion',
      'Workspace.getActiveViewOfType',
      'Workspace.iterateAllLeaves',
    ]));
    expect(report.nodeModules).toEqual([]);
  });

  it('detects unsupported Node and Electron runtime dependencies', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin } = require("obsidian");
      const fs = require("fs");
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

  it('allows safe runtime modules while still marking the package as partial', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin } = require("obsidian");
      const path = require("path");
      const crypto = require("crypto");
      const { Buffer } = require("buffer");
      const { EventEmitter } = require("events");
      const { URL } = require("node:url");
      const util = require("util");
      const assert = require("assert");
      module.exports = class Example extends Plugin {
        onload() {
          const emitter = new EventEmitter();
          assert.ok(Buffer.from(path.basename('notes/a.md')));
          emitter.emit('ready', new URL('https://example.com'));
          return util.format('%s:%s', 'digest', crypto.createHash('sha256').update('a').digest('hex'));
        }
      }
    `);

    expect(report.nodeModules).toEqual(expect.arrayContaining(['path', 'crypto', 'buffer', 'events', 'node:url', 'util', 'assert']));
    expect(report.supportedModules).toEqual(expect.arrayContaining(['path', 'crypto', 'buffer', 'events', 'node:url', 'util', 'assert']));
    expect(report.unsupportedModules).toEqual([]);
    expect(report.blockers).toEqual([]);
    expect(getCompatibilityLevel(report)).toBe('partial');
  });

  it('classifies partially supported advanced APIs as partial compatibility', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin, ItemView, requestUrl } = require('obsidian');
      module.exports = class Example extends Plugin {
        onload() {
          requestUrl('https://example.com');
          this.registerView('calendar', () => new ItemView());
          this.registerExtensions(['calendar'], 'calendar');
          this.registerEditorExtension([]);
        }
      }
    `);

    expect(report.obsidianApis).toEqual(
      expect.arrayContaining(['ItemView', 'requestUrl', 'registerView', 'registerExtensions', 'registerEditorExtension']),
    );
    expect(report.partialApis).toContain('requestUrl');
    expect(report.partialApis).toEqual(
      expect.arrayContaining(['ItemView', 'requestUrl', 'registerView', 'registerExtensions', 'registerEditorExtension']),
    );
    expect(getCompatibilityLevel(report)).toBe('partial');
  });

  it('recognizes implemented workspace, vault, and metadata accessor APIs', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin } = require('obsidian');
      module.exports = class Example extends Plugin {
        onload() {
          const active = this.app.workspace.getActiveFile();
          this.app.vault.getAbstractFileByPath('notes/today.md');
          this.app.vault.getFileByPath('notes/today.md');
          this.app.vault.getFolderByPath('notes');
          this.app.vault.getFiles();
          this.app.vault.getMarkdownFiles();
          this.app.vault.getAllLoadedFiles();
          this.app.metadataCache.resolvedLinks;
          this.app.metadataCache.unresolvedLinks;
          return active;
        }
      }
    `);

    expect(report.obsidianApis).toEqual(expect.arrayContaining([
      'Workspace.getActiveFile',
      'Vault.getAbstractFileByPath',
      'Vault.getFileByPath',
      'Vault.getFolderByPath',
      'Vault.getFiles',
      'Vault.getMarkdownFiles',
      'Vault.getAllLoadedFiles',
      'MetadataCache.resolvedLinks',
      'MetadataCache.unresolvedLinks',
    ]));
    expect(report.supportedApis).toEqual(expect.arrayContaining([
      'Vault.getAbstractFileByPath',
      'Vault.getFileByPath',
      'Vault.getFolderByPath',
      'Vault.getFiles',
      'Vault.getMarkdownFiles',
      'Vault.getAllLoadedFiles',
      'MetadataCache.resolvedLinks',
      'MetadataCache.unresolvedLinks',
    ]));
    expect(report.partialApis).toContain('Workspace.getActiveFile');
    expect(report.unsupportedApis).toEqual([]);
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

  it('keeps desktop-only manifests as a platform requirement instead of a hard blocker', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin } = require('obsidian');
      module.exports = class DesktopOnly extends Plugin {}
    `, { isDesktopOnly: true });

    expect(report.platformRequirements).toMatchObject({
      desktop: true,
      reasons: ['Manifest declares this plugin is desktop-only.'],
    });
    expect(report.blockers).toEqual([]);
    expect(getCompatibilityLevel(report)).toBe('partial');
  });

  it('flags dynamic require and unknown Obsidian APIs for manual review', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin, FileSystemAdapter } = require('obsidian');
      const moduleName = 'fs';
      require(moduleName);
      module.exports = class DynamicPlugin extends Plugin {}
    `);

    expect(report.unsupportedApis).toContain('FileSystemAdapter');
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.stringMatching(/dynamic require/i),
    ]));
    expect(getCompatibilityLevel(report)).toBe('blocked');
  });

  it('blocks every non-Obsidian literal module import the runtime cannot resolve', () => {
    const report = analyzePluginCompatibility(`
      import preset from './preset.json';
      const { Plugin } = require('obsidian');
      const helper = require('./helper');
      const lodash = require('lodash');
      async function loadChunk() {
        return import('./chunk.js');
      }
      module.exports = class ModulePlugin extends Plugin {}
    `);

    expect(report.moduleImports).toEqual(expect.arrayContaining([
      './chunk.js',
      './helper',
      './preset.json',
      'lodash',
    ]));
    expect(report.unsupportedModules).toEqual(expect.arrayContaining([
      './chunk.js',
      './helper',
      './preset.json',
      'lodash',
    ]));
    expect(report.nodeModules).toEqual([]);
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('unsupported runtime module: ./helper'),
      expect.stringContaining('unsupported runtime module: lodash'),
    ]));
    expect(getCompatibilityLevel(report)).toBe('blocked');
  });
});
