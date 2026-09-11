import { describe, expect, it } from 'vitest';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';
import { analyzePluginCompatibility } from '@/lib/obsidian-compat/compatibility-report';

describe('Obsidian workspace DOM class chain', () => {
  it('places WorkspaceSplit on the official WorkspaceParent → WorkspaceItem → Events chain', () => {
    const mod = createObsidianModule();
    const split = new mod.WorkspaceSplit();
    expect(split).toBeInstanceOf(mod.WorkspaceSplit);
    expect(split).toBeInstanceOf(mod.WorkspaceParent);
    expect(split).toBeInstanceOf(mod.WorkspaceItem);
    expect(split).toBeInstanceOf(mod.Events);
  });

  it('places WorkspaceWindow on the WorkspaceContainer chain with honest null window handles', () => {
    const mod = createObsidianModule();
    const win = new mod.WorkspaceWindow();
    expect(win).toBeInstanceOf(mod.WorkspaceWindow);
    expect(win).toBeInstanceOf(mod.WorkspaceContainer);
    expect(win).toBeInstanceOf(mod.WorkspaceSplit);
    // The server tier has no real window or document; the fields exist but stay null.
    expect(win.win).toBeNull();
    expect(win.doc).toBeNull();
  });

  it('keeps WorkspaceLeaf on the WorkspaceItem chain', () => {
    const mod = createObsidianModule();
    const leaf = new mod.WorkspaceLeaf();
    expect(leaf).toBeInstanceOf(mod.WorkspaceItem);
    expect(leaf).toBeInstanceOf(mod.Events);
  });

  it('walks parent links to find the root item and nearest container', () => {
    const mod = createObsidianModule();
    const root = new mod.WorkspaceSplit();
    const child = new mod.WorkspaceSplit(root);
    const grandChild = new mod.WorkspaceSplit(child);
    expect(grandChild.parent).toBe(child);
    expect(grandChild.getRoot()).toBe(root);

    const win = new mod.WorkspaceWindow();
    const split = new mod.WorkspaceSplit(win);
    expect(split.getContainer()).toBe(win);
  });

  it('returns itself as root for a parentless item', () => {
    const mod = createObsidianModule();
    const split = new mod.WorkspaceSplit();
    expect(split.getRoot()).toBe(split);
  });

  it('exposes the Workspace class used by the app shim', () => {
    const mod = createObsidianModule();
    expect(typeof mod.Workspace).toBe('function');
  });

  it('classifies the workspace DOM exports as supported APIs', () => {
    const report = analyzePluginCompatibility(
      'const { Workspace, WorkspaceSplit, WorkspaceParent, WorkspaceItem, WorkspaceContainer, WorkspaceWindow } = require("obsidian");',
    );
    for (const api of ['Workspace', 'WorkspaceSplit', 'WorkspaceParent', 'WorkspaceItem', 'WorkspaceContainer', 'WorkspaceWindow']) {
      expect(report.obsidianApis).toContain(api);
      expect(report.unsupportedApis).not.toContain(api);
    }
  });
});
