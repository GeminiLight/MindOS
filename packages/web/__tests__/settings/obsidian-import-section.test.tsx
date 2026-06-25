// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ObsidianImportSection } from '@/components/settings/ObsidianImportSection';
import {
  OBSIDIAN_LINTER_PROFILE_STORAGE_KEY,
  readObsidianLinterProfilePreference,
  resetObsidianLinterProfilePreference,
  saveObsidianLinterProfilePreference,
} from '@/lib/stores/obsidian-linter-profile-store';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ObsidianImportSection', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetObsidianLinterProfilePreference();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('shows a migration report, imports selected plugins, and exposes handoff links', async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/obsidian/compat-report')) {
        return {
          ok: true,
          vaultRoot: '/Users/test/Vault',
          configDir: '.obsidian-mobile',
          sourcePluginsPath: '.obsidian-mobile/plugins',
          summary: {
            total: 2,
            compatible: 1,
            partial: 0,
            blocked: 1,
            importable: 1,
            selectedByDefault: 1,
            enabledInObsidian: 1,
            hotkeys: 2,
            hasEnabledList: true,
            pluginsDirFound: true,
            support: { ready: 1, limited: 0, review: 0, blocked: 1 },
          },
          migration: {
            defaultSelectionPolicy: 'Source-enabled plugins that are ready or limited are selected by default.',
            sourceVaultUnchanged: true,
            sourcePluginsPath: '.obsidian-mobile/plugins',
            writesTo: '.mindos/plugins/<plugin-id>',
            writesConfig: 'obsidian-import.json',
            enableAfterImport: false,
          },
          plugins: [
            {
              id: 'ready-plugin',
              manifest: { id: 'ready-plugin', name: 'Ready Plugin', version: '1.0.0', description: 'Ready to copy' },
              compatibilityLevel: 'compatible',
              compatibility: {
                obsidianApis: ['Plugin', 'addCommand'],
                nodeModules: [],
                supportedApis: ['Plugin', 'addCommand'],
                partialApis: [],
                unsupportedApis: [],
                blockers: [],
              },
              hasStyles: true,
              hasData: true,
              importable: true,
              support: {
                kind: 'ready',
                importable: true,
                defaultSelected: true,
                label: 'Ready',
                summaryLabel: 'ready',
                reason: 'Supported APIs can load through the MindOS Obsidian compatibility host.',
              },
              surfacePreview: [{ id: 'commands', state: 'mounted', count: 1 }],
              coverageSummary: { full: 2, limited: 0, 'snapshot-only': 0, 'catalog-only': 0, 'request-only': 0, unsupported: 0 },
              compatibilityPreview: {
                schemaVersion: 1,
                pluginId: 'ready-plugin',
                packagePath: {
                  sourcePath: '.obsidian-mobile/plugins/ready-plugin',
                  targetPath: '.mindos/plugins/ready-plugin',
                  copiedFiles: ['manifest.json', 'main.js', 'styles.css', 'data.json', 'obsidian-import.json'],
                  sourceVaultUnchanged: true,
                  enableAfterImport: false,
                },
                supportKind: 'ready',
                blockedReasons: [],
                warnings: [],
                settingsMappings: [
                  {
                    id: 'obsidian-enabled-state',
                    label: 'Source enabled state',
                    source: 'community-plugins.json',
                    mappedItems: ['ready-plugin'],
                    ignoredItems: [],
                    warnings: ['Source enabled state only affects default selection; imported plugins remain disabled until enabled in MindOS.'],
                    appliedOnImport: false,
                  },
                ],
                workflowOutcomes: [
                  {
                    id: 'generic-plugin-commands',
                    label: 'Run plugin commands',
                    status: 'available',
                    evidence: ['Command APIs map to MindOS Command Center.'],
                    nextStep: 'Enable the plugin, then run commands from Command Center.',
                  },
                ],
                runtimeCapabilityLedger: [
                  {
                    capability: 'addCommand',
                    surface: 'commands',
                    support: 'full',
                    phase: 'predicted',
                    source: 'static-analysis',
                    evidence: 'main.js static analysis detected Obsidian API "addCommand".',
                  },
                ],
                nextSteps: ['Import package into .mindos/plugins/ready-plugin.'],
              },
              migrationPlan: {
                copiedFiles: ['manifest.json', 'main.js', 'styles.css', 'data.json', 'obsidian-import.json'],
                sourceVaultUnchanged: true,
                enableAfterImport: false,
                defaultSelected: true,
              },
              obsidianConfig: {
                enabledInObsidian: true,
                hasEnabledList: true,
                hotkeyCount: 2,
                hotkeys: [],
              },
            },
            {
              id: 'blocked-plugin',
              manifest: { id: 'blocked-plugin', name: 'Blocked Plugin', version: '1.0.0' },
              compatibilityLevel: 'blocked',
              compatibility: {
                obsidianApis: ['Plugin'],
                nodeModules: ['electron'],
                supportedApis: ['Plugin'],
                partialApis: [],
                unsupportedApis: [],
                blockers: ['Requires unsupported runtime module: electron'],
              },
              hasStyles: false,
              hasData: false,
              importable: false,
              support: {
                kind: 'blocked',
                importable: false,
                defaultSelected: false,
                label: 'Blocked',
                summaryLabel: 'blocked',
                reason: 'Requires unsupported runtime module: electron',
              },
              surfacePreview: [],
              coverageSummary: { full: 1, limited: 0, 'snapshot-only': 0, 'catalog-only': 0, 'request-only': 0, unsupported: 0 },
              migrationPlan: {
                copiedFiles: ['manifest.json', 'main.js', 'obsidian-import.json'],
                sourceVaultUnchanged: true,
                enableAfterImport: false,
                defaultSelected: false,
              },
              obsidianConfig: {
                enabledInObsidian: false,
                hasEnabledList: true,
                hotkeyCount: 0,
                hotkeys: [],
              },
            },
          ],
          skipped: [
            { dirName: 'broken-plugin', reason: 'manifest.json is missing' },
          ],
        };
      }
      if (url === '/api/obsidian/import' && init?.method === 'POST') {
        return {
          ok: true,
          imported: {
            pluginId: 'ready-plugin',
            copiedFiles: ['manifest.json', 'main.js', 'styles.css', 'data.json', 'obsidian-import.json'],
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await act(async () => {
      root.render(<ObsidianImportSection initialExpanded />);
      await flushPromises();
    });

    const inputs = host.querySelectorAll('input');
    const input = inputs[0] as HTMLInputElement;
    const configInput = inputs[1] as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '~/Vault');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(configInput, '.obsidian-mobile');
      configInput.dispatchEvent(new Event('input', { bubbles: true }));
      await flushPromises();
    });

    const scanButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Scan') as HTMLButtonElement;
    await act(async () => {
      scanButton.click();
      await flushPromises();
    });

    expect(host.textContent).toContain('Migration report');
    expect(host.textContent).toContain('Source-enabled plugins that are ready or limited are selected by default.');
    expect(host.textContent).toContain('Ready Plugin');
    expect(host.textContent).toContain('ready 1');
    expect(host.textContent).toContain('Skipped plugin folders');
    expect(host.textContent).toContain('broken-plugin');
    expect(host.textContent).toContain('manifest.json is missing');
    expect(host.textContent).toContain('Copy manifest.json, main.js, styles.css, data.json, obsidian-import.json');
    expect(host.textContent).toContain('.obsidian-mobile/plugins/ready-plugin');
    expect(host.textContent).toContain('.mindos/plugins/ready-plugin');
    expect(host.textContent).toContain('Workflow: Run plugin commands available');
    expect(host.textContent).toContain('Ledger: 1 predicted');
    expect(host.textContent).toContain('Next: Import package into .mindos/plugins/ready-plugin.');
    expect(host.textContent).toContain('.obsidian-mobile/plugins');
    expect(host.textContent).toContain('.mindos/plugins/<plugin-id>');
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/obsidian/compat-report?vaultRoot=~%2FVault&configDir=.obsidian-mobile');

    const importButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Import 1 plugin')) as HTMLButtonElement;
    await act(async () => {
      importButton.click();
      await flushPromises();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/obsidian/import', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ vaultRoot: '/Users/test/Vault', pluginId: 'ready-plugin', configDir: '.obsidian-mobile' }),
    }));
    expect(host.textContent).toContain('1 imported, 0 failed');
    expect(host.textContent).toContain('Manage installed');
    expect(host.textContent).toContain('Open surfaces');
  });

  it('applies an imported Obsidian Linter profile to the browser editor preference', async () => {
    saveObsidianLinterProfilePreference({
      enabledRules: {
        'heading-space': false,
        'trailing-whitespace': true,
        'multiple-blank-lines': true,
      },
      maxConsecutiveBlankLines: 3,
    });

    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/obsidian/compat-report')) {
        return {
          ok: true,
          vaultRoot: '/Users/test/Vault',
          configDir: '.obsidian',
          sourcePluginsPath: '.obsidian/plugins',
          summary: {
            total: 1,
            compatible: 1,
            partial: 0,
            blocked: 0,
            importable: 1,
            selectedByDefault: 1,
            enabledInObsidian: 1,
            hotkeys: 0,
            hasEnabledList: true,
            pluginsDirFound: true,
            support: { ready: 1, limited: 0, review: 0, blocked: 0 },
          },
          migration: {
            defaultSelectionPolicy: 'Ready plugins are selected by default.',
            sourceVaultUnchanged: true,
            sourcePluginsPath: '.obsidian/plugins',
            writesTo: '.mindos/plugins/<plugin-id>',
            writesConfig: 'obsidian-import.json',
            enableAfterImport: false,
          },
          plugins: [
            {
              id: 'obsidian-linter',
              manifest: { id: 'obsidian-linter', name: 'Linter', version: '1.0.0' },
              compatibilityLevel: 'compatible',
              compatibility: {
                obsidianApis: ['Plugin'],
                nodeModules: [],
                supportedApis: ['Plugin'],
                partialApis: [],
                unsupportedApis: [],
                blockers: [],
              },
              hasStyles: false,
              hasData: true,
              importable: true,
              support: {
                kind: 'ready',
                importable: true,
                defaultSelected: true,
                label: 'Ready',
                summaryLabel: 'ready',
                reason: 'Supported APIs can load through the MindOS Obsidian compatibility host.',
              },
              surfacePreview: [],
              coverageSummary: { full: 1, limited: 0, 'snapshot-only': 0, 'catalog-only': 0, 'request-only': 0, unsupported: 0 },
              compatibilityPreview: {
                schemaVersion: 1,
                pluginId: 'obsidian-linter',
                packagePath: {
                  sourcePath: '.obsidian/plugins/obsidian-linter',
                  targetPath: '.mindos/plugins/obsidian-linter',
                  copiedFiles: ['manifest.json', 'main.js', 'data.json', 'obsidian-import.json'],
                  sourceVaultUnchanged: true,
                  enableAfterImport: false,
                },
                supportKind: 'ready',
                blockedReasons: [],
                warnings: [],
                settingsMappings: [
                  {
                    id: 'obsidian-linter-profile',
                    label: 'Linter rule profile',
                    source: 'data.json',
                    mappedItems: ['trailing-whitespace', 'multiple-blank-lines', 'missing-final-newline'],
                    ignoredItems: ['yaml-title'],
                    warnings: [],
                    appliedOnImport: true,
                  },
                ],
                workflowOutcomes: [
                  {
                    id: 'linter-markdown-source-editor',
                    label: 'Lint Markdown in the source editor',
                    status: 'available',
                    evidence: ['MindOS uses its own Linter adapter and explicit review/apply/undo flow.'],
                    nextStep: 'Import, then open a Markdown source editor and use Lint preview.',
                  },
                ],
                runtimeCapabilityLedger: [
                  {
                    capability: 'Plugin',
                    surface: 'core',
                    support: 'full',
                    phase: 'predicted',
                    source: 'static-analysis',
                    evidence: 'main.js static analysis detected Obsidian API "Plugin".',
                  },
                ],
                nextSteps: [
                  'Import package into .mindos/plugins/obsidian-linter.',
                  'Review mapped Linter settings before enabling source-editor linting.',
                ],
              },
              migrationPlan: {
                copiedFiles: ['manifest.json', 'main.js', 'data.json', 'obsidian-import.json'],
                sourceVaultUnchanged: true,
                enableAfterImport: false,
                defaultSelected: true,
              },
              obsidianConfig: {
                enabledInObsidian: true,
                hasEnabledList: true,
                hotkeyCount: 0,
                hotkeys: [],
              },
            },
          ],
          skipped: [],
        };
      }
      if (url === '/api/obsidian/import' && init?.method === 'POST') {
        return {
          ok: true,
          imported: {
            pluginId: 'obsidian-linter',
            copiedFiles: ['manifest.json', 'main.js', 'data.json', 'obsidian-import.json'],
            linterProfile: {
              schemaVersion: 1,
              source: 'obsidian-linter-data-json',
              pluginId: 'obsidian-linter',
              mappedRules: ['trailing-whitespace', 'multiple-blank-lines', 'missing-final-newline'],
              ignoredRules: ['yaml-title'],
              warnings: [],
              profile: {
                enabledRules: {
                  'heading-space': true,
                  'trailing-whitespace': false,
                  'hard-tab': true,
                  'multiple-blank-lines': false,
                  'missing-final-newline': true,
                },
                maxConsecutiveBlankLines: 1,
              },
            },
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await act(async () => {
      root.render(<ObsidianImportSection initialExpanded />);
      await flushPromises();
    });

    const input = host.querySelector('#obsidian-vault-path') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '~/Vault');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flushPromises();
    });

    const scanButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Scan') as HTMLButtonElement;
    await act(async () => {
      scanButton.click();
      await flushPromises();
    });

    const importButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Import 1 plugin')) as HTMLButtonElement;
    await act(async () => {
      importButton.click();
      await flushPromises();
    });

    expect(readObsidianLinterProfilePreference()).toMatchObject({
      maxConsecutiveBlankLines: 3,
      enabledRules: {
        'heading-space': false,
        'trailing-whitespace': false,
        'multiple-blank-lines': false,
        'missing-final-newline': true,
      },
    });
    expect(localStorage.getItem(OBSIDIAN_LINTER_PROFILE_STORAGE_KEY)).toContain('trailing-whitespace');
    expect(host.textContent).toContain('Settings: Linter rule profile / 3 mapped / 1 ignored');
    expect(host.textContent).toContain('Workflow: Lint Markdown in the source editor available');
    expect(host.textContent).toContain('obsidian-linter copied manifest.json, main.js, data.json, obsidian-import.json; applied Linter profile (3 rules)');
  });
});
