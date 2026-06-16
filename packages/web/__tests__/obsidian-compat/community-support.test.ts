import { describe, expect, it } from 'vitest';
import {
  buildObsidianCommunityPreflightSupport,
  buildObsidianCommunitySurfacePreview,
  type ObsidianCommunitySupportInput,
} from '@/lib/obsidian-compat/community-support';

function supportInput(overrides: Partial<ObsidianCommunitySupportInput> = {}): ObsidianCommunitySupportInput {
  const compatibility = overrides.compatibility ?? {
    level: 'compatible',
    report: {
      obsidianApis: ['Plugin'],
      moduleImports: [],
      nodeModules: [],
      unsupportedModules: [],
      supportedApis: ['Plugin'],
      partialApis: [],
      unsupportedApis: [],
      blockers: [],
    },
  };

  return {
    compatibility,
    installable: overrides.installable ?? true,
    installBlockedReasons: overrides.installBlockedReasons ?? [],
    stylesCss: overrides.stylesCss ?? false,
  };
}

describe('Obsidian community preflight support projection', () => {
  it('projects fully supported APIs into mounted MindOS surfaces', () => {
    const input = supportInput({
      compatibility: {
        level: 'compatible',
        report: {
          obsidianApis: ['Plugin', 'addCommand', 'addSettingTab', 'Vault.create'],
          moduleImports: [],
          nodeModules: [],
          unsupportedModules: [],
          supportedApis: ['Plugin', 'addCommand', 'addSettingTab', 'Vault.create'],
          partialApis: [],
          unsupportedApis: [],
          blockers: [],
        },
      },
      stylesCss: true,
    });

    expect(buildObsidianCommunityPreflightSupport(input)).toMatchObject({
      kind: 'ready',
      label: 'Ready',
      installable: true,
    });
    expect(buildObsidianCommunitySurfacePreview(input)).toEqual([
      { id: 'commands', state: 'mounted', count: 1 },
      { id: 'settings', state: 'mounted', count: 1 },
      { id: 'styles', state: 'mounted', count: 1 },
      { id: 'vault', state: 'mounted', count: 1 },
    ]);
  });

  it('keeps partial hosts installable but labels their surfaces as limited or catalog-only', () => {
    const input = supportInput({
      compatibility: {
        level: 'partial',
        report: {
          obsidianApis: ['Plugin', 'registerView', 'registerMarkdownCodeBlockProcessor', 'registerEditorExtension', 'requestUrl'],
          moduleImports: [],
          nodeModules: [],
          unsupportedModules: [],
          supportedApis: ['Plugin', 'requestUrl'],
          partialApis: ['registerView', 'registerMarkdownCodeBlockProcessor', 'registerEditorExtension'],
          unsupportedApis: [],
          blockers: [],
        },
      },
    });

    expect(buildObsidianCommunityPreflightSupport(input).kind).toBe('limited');
    expect(buildObsidianCommunitySurfacePreview(input)).toEqual([
      { id: 'views', state: 'limited', count: 1 },
      { id: 'document', state: 'limited', count: 1 },
      { id: 'editor', state: 'catalog', count: 1 },
      { id: 'network', state: 'limited', count: 1 },
    ]);
  });

  it('marks unsupported APIs as review when no install blocker exists', () => {
    const input = supportInput({
      compatibility: {
        level: 'partial',
        report: {
          obsidianApis: ['Plugin', 'ImaginaryNativeApi'],
          moduleImports: [],
          nodeModules: [],
          unsupportedModules: [],
          supportedApis: ['Plugin'],
          partialApis: [],
          unsupportedApis: ['ImaginaryNativeApi'],
          blockers: [],
        },
      },
    });

    expect(buildObsidianCommunityPreflightSupport(input)).toMatchObject({
      kind: 'review',
      installable: true,
      reason: 'Unsupported APIs need manual review: ImaginaryNativeApi',
    });
    expect(buildObsidianCommunitySurfacePreview(input)).toEqual([]);
  });

  it('forces blocked support and blocked surface diagnostics when install is not allowed', () => {
    const input = supportInput({
      compatibility: {
        level: 'compatible',
        report: {
          obsidianApis: ['Plugin', 'addCommand'],
          moduleImports: [],
          nodeModules: [],
          unsupportedModules: [],
          supportedApis: ['Plugin', 'addCommand'],
          partialApis: [],
          unsupportedApis: [],
          blockers: [],
        },
      },
      installable: false,
      installBlockedReasons: ['Manifest id "remote" does not match requested plugin id "local".'],
    });

    expect(buildObsidianCommunityPreflightSupport(input)).toMatchObject({
      kind: 'blocked',
      installable: false,
      reason: 'Manifest id "remote" does not match requested plugin id "local".',
    });
    expect(buildObsidianCommunitySurfacePreview(input)).toEqual([
      { id: 'commands', state: 'blocked', count: 1 },
    ]);
  });

  it('labels native runtime module blockers without turning every detected surface red', () => {
    const input = supportInput({
      compatibility: {
        level: 'blocked',
        report: {
          obsidianApis: ['Plugin', 'addCommand'],
          moduleImports: ['fs'],
          nodeModules: ['fs'],
          unsupportedModules: ['fs'],
          supportedApis: ['Plugin', 'addCommand'],
          partialApis: [],
          unsupportedApis: [],
          blockers: ['Requires unsupported runtime module: fs'],
        },
      },
      installable: false,
      installBlockedReasons: ['Requires unsupported runtime module: fs'],
    });

    expect(buildObsidianCommunityPreflightSupport(input)).toMatchObject({
      kind: 'native',
      label: 'Needs native runtime',
      installable: false,
      reason: 'Requires native Desktop capabilities that are not yet exposed to community plugins: fs.',
    });
    expect(buildObsidianCommunitySurfacePreview(input)).toEqual([
      { id: 'commands', state: 'mounted', count: 1 },
    ]);
  });
});
