import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Component } from '@/lib/obsidian-compat/component';
import { Events } from '@/lib/obsidian-compat/events';
import { Plugin } from '@/lib/obsidian-compat/shims/plugin';
import type { App, Command, PluginManifest } from '@/lib/obsidian-compat/types';

class ChildComponent extends Component {
  loaded = false;
  unloaded = false;
  override onload(): void {
    this.loaded = true;
  }
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
  const registerHoverLinkSource = vi.fn();

  const app: App = {
    vault: {} as App['vault'],
    metadataCache: {} as App['metadataCache'],
    workspace: {
      registerHoverLinkSource,
    } as unknown as App['workspace'],
    fileManager: {} as App['fileManager'],
    secretStorage: {
      setSecret: vi.fn(),
      getSecret: vi.fn(),
      listSecrets: vi.fn(),
    },
    isDarkMode: () => false,
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
    removeLocalStorage: () => {},
    registerCommand,
    unregisterCommand,
    commands: {} as App['commands'],
    customCss: {} as App['customCss'],
  };

  return { app, registerCommand, unregisterCommand, registerHoverLinkSource };
};

const manifest: PluginManifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
};

describe('Events', () => {
  it('binds callback context and supports offref cleanup', () => {
    const events = new Events();
    const ctx = { prefix: 'ctx:' };
    const callback = vi.fn(function (this: typeof ctx, value: string) {
      return `${this.prefix}${value}`;
    });

    expect(events.trigger('ready', 'skip')).toEqual([]);
    const ref = events.on('ready', callback, ctx);

    expect(events.trigger('ready', 'value')).toEqual(['ctx:value']);
    events.offref(ref);
    expect(events.tryTrigger('ready', ['again'])).toEqual([]);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('isolates throwing event callbacks and continues triggering listeners', () => {
    const events = new Events();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn(() => 'ok');

    events.on('changed', () => {
      throw new Error('boom');
    });
    events.on('changed', good);

    expect(events.trigger('changed')).toEqual([undefined, 'ok']);
    expect(good).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Event 'changed' callback error"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});

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

  it('loads existing and newly added children when parent is already loaded', async () => {
    const parent = new ParentComponent();
    const beforeLoad = new ChildComponent();
    const afterLoad = new ChildComponent();

    expect(parent.addChild(beforeLoad)).toBe(beforeLoad);
    await parent.load();
    expect(beforeLoad.loaded).toBe(true);

    expect(parent.addChild(afterLoad)).toBe(afterLoad);
    await Promise.resolve();
    expect(afterLoad.loaded).toBe(true);
  });

  it('unloads removed child components immediately', async () => {
    const parent = new ParentComponent();
    const child = new ChildComponent();

    parent.addChild(child);
    await parent.load();
    expect(parent.removeChild(child)).toBe(child);
    await Promise.resolve();

    expect(child.unloaded).toBe(true);
  });

  it('removes DOM listeners with the same options on unload', async () => {
    const component = new ParentComponent();
    const target = new EventTarget();
    const callback = vi.fn();
    const options = { capture: true };

    component.registerDomEvent(target, 'click', callback, options);
    target.dispatchEvent(new Event('click'));
    await component.unload();
    target.dispatchEvent(new Event('click'));

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('clears registered intervals on unload', async () => {
    vi.useFakeTimers();
    const component = new ParentComponent();
    const tick = vi.fn();
    const id = setInterval(tick, 1000) as unknown as number;

    expect(component.registerInterval(id)).toBe(id);
    await component.unload();
    vi.advanceTimersByTime(3000);

    expect(tick).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps lifecycle children isolated from plugin-defined children properties', async () => {
    const parent = new ParentComponent() as ParentComponent & { children: unknown[] };
    const child = new ChildComponent();
    parent.children = [];

    expect(parent.addChild(child)).toBe(child);
    await parent.unload();

    expect(parent.children).toEqual([]);
    expect(child.unloaded).toBe(true);
  });

  it('treats unload as idempotent and ignores reentrant unload calls', async () => {
    class ReentrantComponent extends Component {
      unloadCalls = 0;
      callback = vi.fn();

      override async onunload(): Promise<void> {
        this.unloadCalls += 1;
        await this.unload();
      }
    }

    const component = new ReentrantComponent();
    component.register(component.callback);

    await component.unload();
    await component.unload();

    expect(component.unloadCalls).toBe(1);
    expect(component.callback).toHaveBeenCalledTimes(1);
  });
});

describe('Plugin', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-plugin-'));
  });

  afterEach(() => {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
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

  it('delegates hover link source registration through the workspace host', () => {
    const { app, registerHoverLinkSource } = createAppStub();
    const plugin = new Plugin(app, manifest, pluginDir);
    const options = {
      display: 'Test links',
      defaultMod: true,
    };

    plugin.registerHoverLinkSource('test-plugin', options);

    expect(registerHoverLinkSource).toHaveBeenCalledWith('test-plugin', options);
  });

  it('creates ribbon and status bar stubs safely outside browser environments', () => {
    const { app } = createAppStub();
    const plugin = new Plugin(app, manifest, pluginDir);

    const ribbon = plugin.addRibbonIcon('icon', 'Title', vi.fn());
    const status = plugin.addStatusBarItem();

    expect(ribbon).toBeTruthy();
    expect(status).toBeTruthy();
  });

  it('does not render plugin-provided ribbon icon names as HTML', () => {
    const { app } = createAppStub();
    const plugin = new Plugin(app, manifest, pluginDir);
    const element = {
      title: '',
      textContent: '',
      addEventListener: vi.fn(),
      set innerHTML(_value: string) {
        throw new Error('unsafe innerHTML assignment');
      },
    };

    vi.stubGlobal('document', {
      createElement: vi.fn(() => element),
    });

    const ribbon = plugin.addRibbonIcon('<img src=x onerror=alert(1)>', 'Title', vi.fn());

    expect(ribbon.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(ribbon.title).toBe('Title');
  });
});
