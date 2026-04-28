import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Component } from '@/lib/obsidian-compat/component';
import { Plugin } from '@/lib/obsidian-compat/shims/plugin';
import type { App, Command, PluginManifest } from '@/lib/obsidian-compat/types';

class ChildComponent extends Component {
  unloaded = false;
  override onunload(): void {
    this.unloaded = true;
  }
}

class ParentComponent extends Component {
  unloaded = false;
  override onunload(): void {
    this.unloaded = true;
  }
}

const createAppStub = () => {
  const registerCommand = vi.fn((pluginId: string, command: Command) => command);
  const unregisterCommand = vi.fn();

  const app: App = {
    vault: {} as App['vault'],
    metadataCache: {} as App['metadataCache'],
    workspace: {} as App['workspace'],
    isDarkMode: () => false,
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
    registerCommand,
    unregisterCommand,
  };

  return { app, registerCommand, unregisterCommand };
};

const manifest: PluginManifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
};

describe('Component', () => {
  it('unloads child components and registered callbacks', async () => {
    const parent = new ParentComponent();
    const child = new ChildComponent();
    const cleanup = vi.fn();

    parent.addChild(child);
    parent.register(cleanup);
    await parent.unload();

    expect(child.unloaded).toBe(true);
    expect(parent.unloaded).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('calls event ref off during unload', async () => {
    const component = new ParentComponent();
    const off = vi.fn();

    component.registerEvent({ off });
    await component.unload();

    expect(off).toHaveBeenCalledTimes(1);
  });
});

describe('Plugin', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-plugin-'));
  });

  afterEach(() => {
    fs.rmSync(pluginDir, { recursive: true, force: true });
  });

  it('loads null when plugin data file does not exist', async () => {
    const { app } = createAppStub();
    const plugin = new Plugin(app, manifest, pluginDir);

    await expect(plugin.loadData()).resolves.toBeNull();
  });

  it('saves and reloads plugin data', async () => {
    const { app } = createAppStub();
    const plugin = new Plugin(app, manifest, pluginDir);

    await plugin.saveData({ enabled: true, count: 2 });

    await expect(plugin.loadData()).resolves.toEqual({ enabled: true, count: 2 });
  });

  it('throws a helpful error when plugin data is invalid JSON', async () => {
    const { app } = createAppStub();
    const plugin = new Plugin(app, manifest, pluginDir);
    fs.writeFileSync(path.join(pluginDir, 'data.json'), '{bad json', 'utf-8');

    await expect(plugin.loadData()).rejects.toThrow(/plugin data/i);
  });

  it('delegates addCommand and removeCommand through the host app', () => {
    const { app, registerCommand, unregisterCommand } = createAppStub();
    const plugin = new Plugin(app, manifest, pluginDir);
    const command: Command = { id: 'hello', name: 'Hello', callback: vi.fn() };

    plugin.addCommand(command);
    plugin.removeCommand('hello');

    expect(registerCommand).toHaveBeenCalledWith('test-plugin', command);
    expect(unregisterCommand).toHaveBeenCalledWith('test-plugin', 'hello');
  });

  it('creates ribbon and status bar stubs safely outside browser environments', () => {
    const { app } = createAppStub();
    const plugin = new Plugin(app, manifest, pluginDir);

    const ribbon = plugin.addRibbonIcon('icon', 'Title', vi.fn());
    const status = plugin.addStatusBarItem();

    expect(ribbon).toBeTruthy();
    expect(status).toBeTruthy();
  });
});
