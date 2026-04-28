import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '@/lib/obsidian-compat/command-registry';

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
