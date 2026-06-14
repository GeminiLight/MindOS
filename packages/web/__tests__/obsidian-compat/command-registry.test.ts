import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '@/lib/obsidian-compat/command-registry';
import { createMarkdownEditorCommandContext } from '@/lib/obsidian-compat/editor-facade';
import type { TFile } from '@/lib/obsidian-compat/types';

const fakeMarkdownFile = {
  path: 'notes/current.md',
  name: 'current.md',
  basename: 'current',
  extension: 'md',
  stat: { ctime: 0, mtime: 0, size: 0 },
  parent: null,
  vault: {},
} as TFile;

describe('CommandRegistry', () => {
  it('registers commands with plugin-prefixed full ids', () => {
    const registry = new CommandRegistry();
    const command = registry.register('plugin-a', { id: 'open', name: 'Open' });

    expect(command.fullId).toBe('obsidian:plugin-a:open');
    expect(registry.list()).toHaveLength(1);
  });

  it('unregisters a single command and all commands for a plugin', () => {
    const registry = new CommandRegistry();
    registry.register('plugin-a', { id: 'first', name: 'First' });
    registry.register('plugin-a', { id: 'second', name: 'Second' });
    registry.register('plugin-b', { id: 'third', name: 'Third' });

    registry.unregister('plugin-a', 'first');
    expect(registry.list().map((item) => item.fullId)).toEqual([
      'obsidian:plugin-a:second',
      'obsidian:plugin-b:third',
    ]);

    registry.unregisterAll('plugin-a');
    expect(registry.list().map((item) => item.fullId)).toEqual(['obsidian:plugin-b:third']);
  });

  it('executes a registered command callback', async () => {
    const registry = new CommandRegistry();
    const callback = vi.fn();
    registry.register('plugin-a', { id: 'run', name: 'Run', callback });

    await registry.execute('obsidian:plugin-a:run');

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('uses checkCallback(true) availability before executing check callbacks', async () => {
    const registry = new CommandRegistry();
    const checkCallback = vi.fn((checking: boolean) => checking ? true : undefined);
    registry.register('plugin-a', { id: 'checked', name: 'Checked', checkCallback });

    expect(registry.getAvailability('obsidian:plugin-a:checked')).toMatchObject({
      executable: true,
      requiresEditor: false,
      callbackType: 'check-callback',
    });

    await registry.execute('obsidian:plugin-a:checked');

    expect(checkCallback).toHaveBeenNthCalledWith(1, true);
    expect(checkCallback).toHaveBeenNthCalledWith(2, true);
    expect(checkCallback).toHaveBeenNthCalledWith(3, false);
  });

  it('rejects check callbacks that are unavailable in the current context', async () => {
    const registry = new CommandRegistry();
    const checkCallback = vi.fn((checking: boolean) => checking ? false : undefined);
    registry.register('plugin-a', { id: 'hidden', name: 'Hidden', checkCallback });

    expect(registry.getAvailability('obsidian:plugin-a:hidden')).toMatchObject({
      executable: false,
      requiresEditor: false,
      callbackType: 'check-callback',
    });

    await expect(registry.execute('obsidian:plugin-a:hidden')).rejects.toThrow(/Command is not available/);
    expect(checkCallback).not.toHaveBeenCalledWith(false);
  });

  it('records editor-only commands without executing them until an editor facade exists', async () => {
    const registry = new CommandRegistry();
    const editorCallback = vi.fn();
    registry.register('plugin-a', { id: 'editor', name: 'Editor', editorCallback });

    expect(registry.getAvailability('obsidian:plugin-a:editor')).toMatchObject({
      executable: false,
      requiresEditor: true,
      callbackType: 'editor-callback',
    });

    await expect(registry.execute('obsidian:plugin-a:editor')).rejects.toThrow(/active Markdown editor context/);
    expect(editorCallback).not.toHaveBeenCalled();
  });

  it('executes editorCallback commands when an active Markdown editor context exists', async () => {
    const registry = new CommandRegistry();
    registry.register('plugin-a', {
      id: 'editor',
      name: 'Editor',
      editorCallback: (editor, view) => {
        editor.setValue(`${editor.getValue()}\nfrom ${view.file.path}`);
      },
    });
    const context = createMarkdownEditorCommandContext(fakeMarkdownFile, { content: '# Current' });

    expect(registry.getAvailability('obsidian:plugin-a:editor', context)).toMatchObject({
      executable: true,
      requiresEditor: true,
      callbackType: 'editor-callback',
    });

    await registry.execute('obsidian:plugin-a:editor', context);

    expect(context.editor.getValue()).toBe('# Current\nfrom notes/current.md');
  });

  it('checks and executes editorCheckCallback commands with the active Markdown editor context', async () => {
    const registry = new CommandRegistry();
    const editorCheckCallback = vi.fn((checking: boolean, editor) => {
      if (checking) return editor.getValue().includes('ready');
      editor.replaceSelection(' done');
    });
    registry.register('plugin-a', {
      id: 'checked-editor',
      name: 'Checked editor',
      editorCheckCallback,
    });
    const context = createMarkdownEditorCommandContext(fakeMarkdownFile, {
      content: 'ready',
      cursorOffset: 'ready'.length,
    });

    expect(registry.getAvailability('obsidian:plugin-a:checked-editor', context)).toMatchObject({
      executable: true,
      requiresEditor: true,
      callbackType: 'editor-check-callback',
    });

    await registry.execute('obsidian:plugin-a:checked-editor', context);

    expect(editorCheckCallback).toHaveBeenNthCalledWith(1, true, context.editor, context.view);
    expect(editorCheckCallback).toHaveBeenNthCalledWith(2, true, context.editor, context.view);
    expect(editorCheckCallback).toHaveBeenNthCalledWith(3, false, context.editor, context.view);
    expect(context.editor.getValue()).toBe('ready done');
  });

  it('throws for missing commands', async () => {
    const registry = new CommandRegistry();

    await expect(registry.execute('obsidian:missing:run')).rejects.toThrow(/Command not found/);
  });

  it('replaces duplicate registrations under the same full id', () => {
    const registry = new CommandRegistry();
    const first = vi.fn();
    const second = vi.fn();

    registry.register('plugin-a', { id: 'run', name: 'Run', callback: first });
    registry.register('plugin-a', { id: 'run', name: 'Run v2', callback: second });

    const command = registry.get('obsidian:plugin-a:run');
    expect(command?.name).toBe('Run v2');
  });
});
