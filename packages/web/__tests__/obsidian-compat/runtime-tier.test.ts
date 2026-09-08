import { describe, expect, it } from 'vitest';
import {
  analyzePluginCompatibility,
  classifyPluginRuntimeTier,
  classifyRuntimeModuleTier,
  getCompatibilityLevel,
} from '@/lib/obsidian-compat/compatibility-report';

describe('Obsidian runtime tier classification', () => {
  it('classifies modules into supported, browser, native and unknown tiers', () => {
    expect(classifyRuntimeModuleTier('path')).toBe('supported');
    expect(classifyRuntimeModuleTier('node:util')).toBe('supported');
    expect(classifyRuntimeModuleTier('@codemirror/state')).toBe('browser');
    expect(classifyRuntimeModuleTier('@lezer/common')).toBe('browser');
    expect(classifyRuntimeModuleTier('codemirror')).toBe('browser');
    expect(classifyRuntimeModuleTier('child_process')).toBe('native');
    expect(classifyRuntimeModuleTier('node:fs')).toBe('native');
    expect(classifyRuntimeModuleTier('fs/promises')).toBe('native');
    expect(classifyRuntimeModuleTier('zlib')).toBe('native');
    expect(classifyRuntimeModuleTier('node:process')).toBe('native');
    expect(classifyRuntimeModuleTier('async_hooks')).toBe('native');
    expect(classifyRuntimeModuleTier('electron')).toBe('native');
    expect(classifyRuntimeModuleTier('@electron/remote')).toBe('native');
    expect(classifyRuntimeModuleTier('ajv/dist/runtime/equal')).toBe('unknown');
    expect(classifyRuntimeModuleTier('left-pad')).toBe('unknown');
    expect(classifyRuntimeModuleTier('')).toBe('unknown');
  });

  it('ignores relative specifiers when deriving tier requirements but keeps them as blockers', () => {
    const tier = classifyPluginRuntimeTier({
      obsidianApis: [],
      unsupportedModules: ['./MyComponent'],
      blockers: ['Requires unsupported runtime module: ./MyComponent'],
    });
    expect(tier).toMatchObject({ required: 'server', loadsInServerTier: false, unknownModules: [], reasons: [] });
  });

  it('marks a plugin that only uses safe APIs as server tier', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin } = require('obsidian');
      module.exports = class extends Plugin {
        onload() { this.addCommand({ id: 'x', name: 'X', callback: () => {} }); }
      };
    `);
    expect(report.runtimeTier).toEqual({
      required: 'server',
      loadsInServerTier: true,
      browserModules: [],
      nativeModules: [],
      unknownModules: [],
      browserApis: [],
      reasons: [],
    });
    expect(getCompatibilityLevel(report)).toBe('compatible');
  });

  it('routes CodeMirror imports and DOM-bound APIs to the browser tier without changing the compatibility level', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin } = require('obsidian');
      const { StateField } = require('@codemirror/state');
      module.exports = class extends Plugin {
        onload() {
          this.registerEditorExtension([]);
          this.registerMarkdownCodeBlockProcessor('dataview', () => {});
        }
      };
    `);
    expect(report.runtimeTier?.required).toBe('browser');
    expect(report.runtimeTier?.loadsInServerTier).toBe(false);
    expect(report.runtimeTier?.browserModules).toEqual(['@codemirror/state']);
    expect(report.runtimeTier?.browserApis).toEqual(['registerEditorExtension', 'registerMarkdownCodeBlockProcessor']);
    expect(report.runtimeTier?.reasons.join(' ')).toMatch(/shared CodeMirror 6/);
    expect(report.blockers).toEqual(['Requires unsupported runtime module: @codemirror/state']);
    expect(getCompatibilityLevel(report)).toBe('blocked');
  });

  it('marks a view-only plugin as browser tier while it still loads in the server tier', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin, ItemView } = require('obsidian');
      module.exports = class extends Plugin {
        onload() { this.registerView('calendar', (leaf) => new ItemView(leaf)); }
      };
    `);
    expect(report.runtimeTier).toMatchObject({ required: 'browser', loadsInServerTier: true, browserApis: ['registerView'] });
  });

  it('prefers the native tier when Node or Electron modules are required', () => {
    const report = analyzePluginCompatibility(`
      const { Plugin } = require('obsidian');
      const { exec } = require('child_process');
      const { StateField } = require('@codemirror/state');
      module.exports = class extends Plugin {};
    `);
    expect(report.runtimeTier).toMatchObject({
      required: 'native',
      loadsInServerTier: false,
      nativeModules: ['child_process'],
      browserModules: ['@codemirror/state'],
    });
    expect(report.runtimeTier?.reasons[0]).toMatch(/Desktop broker tier: child_process/);
  });

  it('keeps unknown third-party modules as blockers of every tier', () => {
    const tier = classifyPluginRuntimeTier({
      obsidianApis: [],
      unsupportedModules: ['left-pad'],
      blockers: ['Requires unsupported runtime module: left-pad'],
    });
    expect(tier).toMatchObject({ required: 'server', loadsInServerTier: false, unknownModules: ['left-pad'] });
    expect(tier.reasons[0]).toMatch(/Unrecognized modules/);
  });
});
