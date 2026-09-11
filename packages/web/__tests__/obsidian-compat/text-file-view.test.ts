import { describe, expect, it } from 'vitest';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';
import { createObsidianElement } from '@/lib/obsidian-compat/shims/dom';
import { analyzePluginCompatibility } from '@/lib/obsidian-compat/compatibility-report';

function createNoteView(mod: ReturnType<typeof createObsidianModule>) {
  const leaf = new mod.WorkspaceLeaf();
  const cleared: string[] = [];
  class NoteView extends mod.TextFileView {
    getViewData(): string {
      return this.data;
    }
    setViewData(data: string, _clear: boolean): void {
      this.data = data;
    }
    clear(): void {
      cleared.push('cleared');
    }
  }
  return { view: new NoteView(leaf), cleared };
}

describe('Obsidian TextFileView compatibility', () => {
  it('places TextFileView on the official EditableFileView → FileView chain', () => {
    const mod = createObsidianModule();
    const { view } = createNoteView(mod);
    expect(view).toBeInstanceOf(mod.TextFileView);
    expect(view).toBeInstanceOf(mod.EditableFileView);
    expect(view).toBeInstanceOf(mod.FileView);
    expect(view).toBeInstanceOf(mod.ItemView);
    expect(view).toBeInstanceOf(mod.Component);
    expect(view.contentEl).toBeDefined();
  });

  it('keeps the leaf reference from the constructor', () => {
    const mod = createObsidianModule();
    const leaf = new mod.WorkspaceLeaf();
    class NoteView extends mod.TextFileView {
      getViewData(): string { return this.data; }
      setViewData(data: string): void { this.data = data; }
      clear(): void {}
    }
    const view = new NoteView(leaf);
    expect(view.leaf).toBe(leaf);
  });

  it('holds in-memory data with empty-string default', () => {
    const mod = createObsidianModule();
    const { view } = createNoteView(mod);
    expect(view.data).toBe('');
    view.setViewData('# Title', false);
    expect(view.getViewData()).toBe('# Title');
  });

  it('save() persists getViewData() back into data and optionally clears', async () => {
    const mod = createObsidianModule();
    const { view, cleared } = createNoteView(mod);
    view.data = 'draft';
    view.getViewData = () => 'final content';
    await expect(view.save()).resolves.toBeUndefined();
    expect(view.data).toBe('final content');
    expect(cleared).toEqual([]);

    await expect(view.save(true)).resolves.toBeUndefined();
    expect(cleared).toEqual(['cleared']);
  });

  it('exposes requestSave as a debounced function and resolves the load/unload hooks', async () => {
    const mod = createObsidianModule();
    const { view } = createNoteView(mod);
    expect(typeof view.requestSave).toBe('function');
    view.requestSave();
    await expect(view.onLoadFile({ path: 'a.md' } as never)).resolves.toBeUndefined();
    await expect(view.onUnloadFile({ path: 'a.md' } as never)).resolves.toBeUndefined();
  });

  it('exports both classes through the obsidian module', () => {
    const mod = createObsidianModule();
    expect(mod.TextFileView).toBeDefined();
    expect(mod.EditableFileView).toBeDefined();
  });

  it('classifies the view exports as partially supported APIs', () => {
    const report = analyzePluginCompatibility(
      'const { TextFileView, EditableFileView } = require("obsidian"); class V extends TextFileView {}',
    );
    expect(report.obsidianApis).toContain('TextFileView');
    expect(report.obsidianApis).toContain('EditableFileView');
    expect(report.unsupportedApis).not.toContain('TextFileView');
    expect(report.unsupportedApis).not.toContain('EditableFileView');
  });

  it('renders nothing into the container but keeps a real content element', () => {
    const mod = createObsidianModule();
    const { view } = createNoteView(mod);
    const host = createObsidianElement('div');
    host.appendChild(view.containerEl);
    expect(view.containerEl.childNodes.length).toBeGreaterThan(0);
  });
});
