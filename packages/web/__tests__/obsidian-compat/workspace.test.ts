import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppShim } from '@/lib/obsidian-compat/shims/app';
import { MarkdownView } from '@/lib/obsidian-compat/shims/obsidian';

let mindRoot: string;
let app: AppShim;

describe('Workspace shim', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-workspace-shim-'));
    app = new AppShim(mindRoot);
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('returns an active MarkdownView while active file context is mounted', async () => {
    const file = await app.vault.create('notes/today.md', '# Today');

    await app.withActiveFile(file, () => {
      const view = app.workspace.getActiveViewOfType(MarkdownView);

      expect(app.workspace.getActiveFile()?.path).toBe('notes/today.md');
      expect(app.workspace.activeEditor?.file.path).toBe('notes/today.md');
      expect(view?.file.path).toBe('notes/today.md');
      expect(view?.getViewType()).toBe('markdown');
      expect(app.workspace.activeLeaf?.getViewState()).toEqual({
        type: 'markdown',
        state: {
          file: {
            path: 'notes/today.md',
            name: 'today.md',
            basename: 'today',
            extension: 'md',
          },
        },
      });
    });

    expect(app.workspace.getActiveFile()).toBeNull();
    expect(app.workspace.getActiveViewOfType(MarkdownView)).toBeNull();
  });

  it('emits Obsidian-style workspace events when active file changes', async () => {
    const first = await app.vault.create('one.md', '# One');
    const second = await app.vault.create('two.md', '# Two');
    const onFileOpen = vi.fn();
    const onActiveLeafChange = vi.fn();
    const onLayoutChange = vi.fn();

    app.workspace.on('file-open', onFileOpen);
    app.workspace.on('active-leaf-change', onActiveLeafChange);
    app.workspace.on('layout-change', onLayoutChange);

    await app.withActiveFile(first, async () => {
      await app.withActiveFile(first, () => {});
      await app.withActiveFile(second, () => {});
    });

    expect(onFileOpen).toHaveBeenCalledWith(first);
    expect(onFileOpen).toHaveBeenCalledWith(second);
    expect(onFileOpen).toHaveBeenLastCalledWith(null);
    expect(onActiveLeafChange).toHaveBeenCalledWith(app.workspace.activeLeaf);
    expect(onLayoutChange).toHaveBeenCalledTimes(4);
  });

  it('iterates tracked leaves and filters leaves by view type', async () => {
    const file = await app.vault.create('notes/today.md', '# Today');
    const secondLeaf = app.workspace.getLeaf(true);
    const rightLeaf = app.workspace.getRightLeaf(false);
    const leftLeaf = app.workspace.getLeftLeaf(true);
    await secondLeaf.setViewState({ type: 'plugin-view', state: { id: 'sample' } });
    await rightLeaf?.setViewState({ type: 'right-sidebar-view', state: { id: 'right' } });
    await leftLeaf?.setViewState({ type: 'left-sidebar-view', state: { id: 'left' } });

    await app.withActiveFile(file, () => {
      const leaves: unknown[] = [];
      app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));

      expect(leaves).toHaveLength(4);
      expect(app.workspace.getLeavesOfType('markdown')).toEqual([app.workspace.activeLeaf]);
      expect(app.workspace.getLeavesOfType('plugin-view')).toEqual([secondLeaf]);
      expect(app.workspace.getLeavesOfType('right-sidebar-view')).toEqual([rightLeaf]);
      expect(app.workspace.getLeavesOfType('left-sidebar-view')).toEqual([leftLeaf]);
      expect(app.workspace.getRightLeaf(false)).toBe(rightLeaf);
      expect(app.workspace.getLeftLeaf(false)).toBe(leftLeaf);
    });
  });

  it('records revealLeaf requests without mounting native panes', async () => {
    const leaf = app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: 'recent-files', state: { source: 'test' } });

    await app.getRuntimeHost().runWithPluginContext('recent-files-obsidian', async () => {
      await app.workspace.revealLeaf(leaf!);
    });

    expect(app.getRuntimeHost().getRuntimeCapabilityLedger('recent-files-obsidian')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'Workspace.revealLeaf',
        surface: 'views',
        support: 'limited',
        phase: 'called',
        evidence: expect.stringContaining('recent-files'),
      }),
    ]));
  });

  it('keeps the active MarkdownView editor read-only outside editor command execution', async () => {
    const file = await app.vault.create('notes/today.md', '# Today\nBody');

    await app.withActiveFile(file, () => {
      const view = app.workspace.getActiveViewOfType(MarkdownView);

      expect(view?.editor.getValue()).toBe('# Today\nBody');
      expect(view?.editor.lineCount()).toBe(2);
      expect(view?.editor.getLine(1)).toBe('Body');
      expect(view?.editor.getRange({ line: 0, ch: 2 }, { line: 0, ch: 7 })).toBe('Today');
      expect(() => view?.editor.setValue('changed')).toThrow(/read-only/i);
    });
  });
});
