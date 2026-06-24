import { describe, expect, it } from 'vitest';
import { buildObsidianCapabilityCoverage } from '@/lib/obsidian-compat/capability-matrix';
import {
  buildObsidianCapabilityGateReport,
  createObsidianCapabilityGateConfirmation,
  isObsidianCapabilityGateConfirmationRequiredError,
} from '@/lib/obsidian-compat/capability-gate';
import {
  assertPluginCapabilityGateAllowsEnable,
  assertPluginCapabilityGateAllowsLoad,
} from '@/lib/obsidian-compat/capability-gate-enforcement';
import type { PluginCompatibilityReport, CompatibilityLevel } from '@/lib/obsidian-compat/compatibility-report';

function reportFor(
  obsidianApis: string[],
  overrides: Partial<PluginCompatibilityReport> = {},
  compatibilityLevel: CompatibilityLevel = 'partial',
) {
  const compatibility: PluginCompatibilityReport = {
    obsidianApis,
    moduleImports: [],
    nodeModules: [],
    supportedModules: [],
    unsupportedModules: [],
    supportedApis: [],
    partialApis: [],
    unsupportedApis: [],
    blockers: [],
    ...overrides,
  };
  return buildObsidianCapabilityGateReport({
    manifest: { id: 'gate-plugin', version: '1.0.0' },
    compatibility,
    compatibilityLevel,
    coverage: buildObsidianCapabilityCoverage(compatibility),
  });
}

describe('Obsidian capability gate', () => {
  it('marks command and settings-only plugins ready without explicit confirmation', () => {
    const gate = reportFor(['Plugin', 'addCommand', 'PluginSettingTab'], {}, 'compatible');

    expect(gate).toMatchObject({
      status: 'ready',
      blocked: false,
      requiresConfirmation: false,
      confirmed: false,
      confirmReasons: [],
      blockedReasons: [],
    });
    expect(gate.items.map((item) => [item.surface, item.decision])).toEqual([
      ['settings', 'granted'],
      ['commands', 'granted'],
      ['core', 'granted'],
    ]);
  });

  it('requires confirmation for network and secret surfaces', () => {
    const gate = reportFor(['Plugin', 'requestUrl', 'SecretStorage']);

    expect(gate.status).toBe('review');
    expect(gate.requiresConfirmation).toBe(true);
    expect(gate.confirmed).toBe(false);
    expect(gate.confirmReasons).toEqual([
      expect.stringContaining('Network APIs can contact external services'),
      expect.stringContaining('Secret APIs can read and write'),
    ]);
    expect(gate.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: 'network', decision: 'requires-confirmation', risk: 'high' }),
      expect.objectContaining({ surface: 'secret', decision: 'requires-confirmation', risk: 'high' }),
    ]));
  });

  it('treats editor registrations as catalog-only instead of blocking enablement', () => {
    const gate = reportFor(['Plugin', 'registerEditorExtension', 'registerEditorSuggest']);

    expect(gate.status).toBe('limited');
    expect(gate.blocked).toBe(false);
    expect(gate.requiresConfirmation).toBe(false);
    expect(gate.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        surface: 'editor',
        decision: 'catalog-only',
        risk: 'medium',
        apis: ['registerEditorExtension', 'registerEditorSuggest'],
      }),
    ]));
  });

  it('requires confirmation for vault and metadata access that can inspect or change notes', () => {
    const gate = reportFor(['Plugin', 'Vault.modify', 'MetadataCache.getFileCache']);

    expect(gate.status).toBe('review');
    expect(gate.requiresConfirmation).toBe(true);
    expect(gate.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: 'vault', decision: 'requires-confirmation', risk: 'high' }),
      expect.objectContaining({ surface: 'metadata', decision: 'requires-confirmation', risk: 'medium' }),
    ]));
  });

  it('blocks unsupported APIs and native blockers even if confirmation is present', () => {
    const gate = reportFor(
      ['Plugin', 'ImaginaryApi'],
      {
        unsupportedModules: ['fs'],
        blockers: ['Requires unsupported runtime module: fs'],
      },
      'blocked',
    );

    const confirmation = createObsidianCapabilityGateConfirmation(gate, '2026-06-24T00:00:00.000Z');
    const confirmedGate = buildObsidianCapabilityGateReport({
      manifest: { id: 'gate-plugin', version: '1.0.0' },
      compatibility: {
        obsidianApis: ['Plugin', 'ImaginaryApi'],
        moduleImports: [],
        nodeModules: [],
        supportedModules: [],
        unsupportedModules: ['fs'],
        supportedApis: [],
        partialApis: [],
        unsupportedApis: [],
        blockers: ['Requires unsupported runtime module: fs'],
      },
      compatibilityLevel: 'blocked',
      coverage: buildObsidianCapabilityCoverage({ obsidianApis: ['Plugin', 'ImaginaryApi'] }),
      confirmation,
    });

    expect(confirmedGate.status).toBe('blocked');
    expect(confirmedGate.blocked).toBe(true);
    expect(confirmedGate.requiresConfirmation).toBe(false);
    expect(confirmedGate.blockedReasons).toEqual(expect.arrayContaining([
      'Requires unsupported runtime module: fs',
      expect.stringContaining('Unsupported Obsidian APIs require'),
    ]));
  });

  it('invalidates a confirmation when the detected capability fingerprint changes', () => {
    const networkGate = reportFor(['Plugin', 'requestUrl']);
    const confirmation = createObsidianCapabilityGateConfirmation(networkGate, '2026-06-24T00:00:00.000Z');
    const vaultGate = buildObsidianCapabilityGateReport({
      manifest: { id: 'gate-plugin', version: '1.0.1' },
      compatibility: {
        obsidianApis: ['Plugin', 'requestUrl', 'Vault.modify'],
        moduleImports: [],
        nodeModules: [],
        supportedModules: [],
        unsupportedModules: [],
        supportedApis: [],
        partialApis: [],
        unsupportedApis: [],
        blockers: [],
      },
      compatibilityLevel: 'partial',
      coverage: buildObsidianCapabilityCoverage({ obsidianApis: ['Plugin', 'requestUrl', 'Vault.modify'] }),
      confirmation,
    });

    expect(networkGate.fingerprint).not.toEqual(vaultGate.fingerprint);
    expect(vaultGate.status).toBe('review');
    expect(vaultGate.confirmed).toBe(false);
  });

  it('creates a fingerprint-scoped confirmation only when enable confirmation is explicit', () => {
    const compatibility: PluginCompatibilityReport = {
      obsidianApis: ['Plugin', 'requestUrl'],
      moduleImports: [],
      nodeModules: [],
      supportedModules: [],
      unsupportedModules: [],
      supportedApis: [],
      partialApis: [],
      unsupportedApis: [],
      blockers: [],
    };
    const subject = {
      id: 'network-plugin',
      manifest: { id: 'network-plugin', name: 'Network Plugin', version: '1.0.0', main: 'main.js' },
      compatibility,
      compatibilityLevel: 'partial' as CompatibilityLevel,
      coverage: buildObsidianCapabilityCoverage(compatibility),
    };

    expect(() => assertPluginCapabilityGateAllowsEnable(subject, {}, {})).toThrow(/requires capability confirmation/i);

    const enabled = assertPluginCapabilityGateAllowsEnable(subject, {}, { confirmCapabilityGate: true });
    expect(enabled.report.confirmed).toBe(true);
    expect(enabled.confirmationStore.capabilityConfirmations?.['network-plugin']).toMatchObject({
      fingerprint: enabled.report.fingerprint,
      surfaces: ['network'],
    });
    expect(() => assertPluginCapabilityGateAllowsLoad(subject, enabled.confirmationStore)).not.toThrow();
  });

  it('keeps unsupported/native capability gate blockers non-bypassable', () => {
    const compatibility: PluginCompatibilityReport = {
      obsidianApis: ['Plugin'],
      moduleImports: ['electron'],
      nodeModules: [],
      supportedModules: [],
      unsupportedModules: ['electron'],
      supportedApis: [],
      partialApis: [],
      unsupportedApis: [],
      blockers: ['Requires unsupported runtime module: electron'],
    };
    const subject = {
      id: 'native-plugin',
      manifest: { id: 'native-plugin', name: 'Native Plugin', version: '1.0.0', main: 'main.js' },
      compatibility,
      compatibilityLevel: 'blocked' as CompatibilityLevel,
      coverage: buildObsidianCapabilityCoverage(compatibility),
    };

    expect(() => assertPluginCapabilityGateAllowsEnable(subject, {}, { confirmCapabilityGate: true }))
      .toThrow(/unsupported runtime module: electron/i);

    try {
      assertPluginCapabilityGateAllowsLoad(subject, {});
      throw new Error('Expected load to fail');
    } catch (error) {
      expect(isObsidianCapabilityGateConfirmationRequiredError(error)).toBe(false);
      expect(error).toBeInstanceOf(Error);
    }
  });
});
