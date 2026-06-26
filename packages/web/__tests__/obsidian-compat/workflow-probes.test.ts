import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';
import {
  ObsidianWorkflowProbeStore,
  buildObsidianWorkflowProbeAudits,
} from '@/lib/obsidian-compat/workflow-probes';

let mindRoot: string;

const writePlugin = (pluginId: string, mainJs: string) => {
  const pluginDir = path.join(mindRoot, '.mindos', 'plugins', pluginId);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id: pluginId, name: pluginId, version: '1.0.0' }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs, 'utf-8');
};

describe('Obsidian workflow probes', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-workflow-probes-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('passes the QuickAdd capture/macro probe only after command execution creates an observable vault result', async () => {
    writePlugin('quickadd', `
      const { Notice, Plugin } = require('obsidian');
      module.exports = class QuickAddPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'capture',
            name: 'QuickAdd Capture',
            callback: async () => {
              await this.app.vault.create('Inbox/quickadd-probe.md', '# Captured from QuickAdd');
              new Notice('QuickAdd capture complete');
            }
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('quickadd', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('quickadd', 'quickadd-capture-macro');

    expect(result).toMatchObject({
      pluginId: 'quickadd',
      id: 'quickadd-capture-macro',
      status: 'passed',
      source: 'workflow-probe',
    });
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execute-command', passed: true }),
      expect.objectContaining({ id: 'observable-result', passed: true }),
      expect.objectContaining({ id: 'runtime-called-ledger', passed: true }),
    ]));
    expect(fs.readFileSync(path.join(mindRoot, 'Inbox', 'quickadd-probe.md'), 'utf-8')).toBe('# Captured from QuickAdd');

    const plugin = manager.list().find((item) => item.id === 'quickadd');
    expect(plugin?.workflowProbeHistory).toMatchObject({
      total: 1,
      latestById: {
        'quickadd-capture-macro': expect.objectContaining({ status: 'passed' }),
      },
    });
    expect(plugin?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'observed',
        source: 'workflow-probe',
        lastProbeStatus: 'passed',
        lastProbedAt: result.completedAt,
      }),
    ]);
  });

  it('passes the Calendar open-periodic-note probe through workspace navigation evidence', async () => {
    fs.writeFileSync(path.join(mindRoot, '2026-06-26.md'), '# Today', 'utf-8');
    writePlugin('calendar', `
      const { Plugin } = require('obsidian');
      module.exports = class CalendarPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'open-today',
            name: 'Open today',
            callback: async () => {
              await this.app.workspace.openLinkText('2026-06-26', 'Daily/source.md');
            }
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot, {
      workflowProbeStore: new ObsidianWorkflowProbeStore(mindRoot, {
        now: () => new Date('2026-06-26T09:00:00.000Z'),
      }),
    });
    await manager.discover();
    await manager.enable('calendar', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('calendar', 'calendar-open-periodic-note');

    expect(result).toMatchObject({
      id: 'calendar-open-periodic-note',
      status: 'passed',
      completedAt: '2026-06-26T09:00:00.000Z',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('workspace open request'),
    ]));
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workspace-open', passed: true }),
      expect.objectContaining({ id: 'runtime-called-ledger', passed: true }),
    ]));
  });

  it('passes the Admonition render probe only when plugin output aligns with the native callout snapshot', async () => {
    writePlugin('obsidian-admonition', `
      const { Plugin } = require('obsidian');
      module.exports = class AdmonitionPlugin extends Plugin {
        onload() {
          this.registerMarkdownPostProcessor((el) => {
            const code = el.querySelector('code');
            if (!code || !code.textContent.includes('MindOS workflow probe')) return;
            el.createDiv({ text: 'note\\nMindOS workflow probe' });
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('obsidian-admonition', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('obsidian-admonition', 'admonition-render-markdown');

    expect(result).toMatchObject({
      pluginId: 'obsidian-admonition',
      id: 'admonition-render-markdown',
      status: 'passed',
      source: 'workflow-probe',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('Native callout snapshot: note'),
      expect.stringContaining('Processor output: note'),
    ]));
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'render-markdown', passed: true }),
      expect.objectContaining({ id: 'native-callout-snapshot', passed: true }),
      expect.objectContaining({ id: 'plugin-native-snapshot-alignment', passed: true }),
      expect.objectContaining({ id: 'runtime-called-ledger', passed: true }),
    ]));
    expect(manager.list().find((item) => item.id === 'obsidian-admonition')?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'admonition-render-markdown',
        status: 'observed',
        source: 'workflow-probe',
        lastProbeStatus: 'passed',
      }),
    ]);
  });

  it('fails a probed workflow when command execution has no observable side effect', async () => {
    writePlugin('quickadd', `
      const { Plugin } = require('obsidian');
      module.exports = class QuickAddPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'capture',
            name: 'QuickAdd Capture',
            callback: () => {}
          });
        }
      };
    `);

    const manager = new PluginManager(mindRoot);
    await manager.discover();
    await manager.enable('quickadd', { confirmCapabilityGate: true });

    const result = await manager.runWorkflowProbe('quickadd', 'quickadd-capture-macro');

    expect(result).toMatchObject({
      id: 'quickadd-capture-macro',
      status: 'failed',
      failureReason: expect.stringContaining('no observable workflow result'),
    });
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execute-command', passed: true }),
      expect.objectContaining({ id: 'observable-result', passed: false }),
    ]));
    expect(manager.list().find((item) => item.id === 'quickadd')?.workflowAudits).toEqual([
      expect.objectContaining({
        id: 'quickadd-capture-macro',
        status: 'partial',
        source: 'workflow-probe',
        lastProbeStatus: 'failed',
        probeFailureReason: expect.stringContaining('no observable workflow result'),
      }),
    ]);
  });

  it('keeps probe history across manager restarts and summarizes latest results by workflow', async () => {
    writePlugin('calendar', `
      const { Plugin } = require('obsidian');
      module.exports = class CalendarPlugin extends Plugin {
        onload() {
          this.addCommand({
            id: 'open-today',
            name: 'Open today',
            callback: async () => {
              await this.app.workspace.openLinkText('missing-note', '');
            }
          });
        }
      };
    `);

    const first = new PluginManager(mindRoot);
    await first.discover();
    await first.enable('calendar', { confirmCapabilityGate: true });
    await first.runWorkflowProbe('calendar', 'calendar-open-periodic-note');

    const restarted = new PluginManager(mindRoot);
    await restarted.discover();
    const plugin = restarted.list().find((item) => item.id === 'calendar');

    expect(plugin?.workflowProbeHistory).toMatchObject({
      total: 1,
      latestById: {
        'calendar-open-periodic-note': expect.objectContaining({
          pluginId: 'calendar',
          id: 'calendar-open-periodic-note',
          status: 'passed',
        }),
      },
    });
    expect(buildObsidianWorkflowProbeAudits(plugin?.workflowProbeHistory).map((item) => item.id)).toEqual([
      'calendar-open-periodic-note',
    ]);
  });
});
