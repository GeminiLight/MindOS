import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  BROWSER_EDITOR_SANDBOX_VERSION,
  validateBrowserEditorSandboxContributions,
  type BrowserEditorSandboxContribution,
  type BrowserEditorSandboxPermissionGrant,
} from '@/lib/obsidian-compat/browser-editor-sandbox';
import { collectBrowserEditorSandboxDecorationSpecs } from '@/lib/editor/browser-editor-sandbox-codemirror';

const permissionGrant: BrowserEditorSandboxPermissionGrant = {
  scope: 'browser-editor-sandbox',
  grantedBy: 'mindos',
  permissions: ['editor.read', 'editor.decorations'],
};

function contribution(overrides: Partial<BrowserEditorSandboxContribution> = {}): BrowserEditorSandboxContribution {
  return {
    sandboxVersion: BROWSER_EDITOR_SANDBOX_VERSION,
    id: 'test-plugin:range:1',
    pluginId: 'test-plugin',
    source: 'mindos-signed',
    kind: 'range-highlight',
    from: 0,
    to: 5,
    tone: 'accent',
    label: 'Important range',
    permissionGrant,
    ...overrides,
  } as BrowserEditorSandboxContribution;
}

describe('browser editor sandbox contributions', () => {
  it('accepts MindOS-signed declarative line and range decorations', () => {
    const result = validateBrowserEditorSandboxContributions([
      contribution(),
      contribution({
        id: 'test-plugin:line:2',
        kind: 'line-highlight',
        line: 2,
        label: 'Line note',
      }),
    ], {
      documentLength: 20,
      lineCount: 3,
    });

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(2);
    expect(result.accepted.map((item) => item.requiredPermissions)).toEqual([
      ['editor.read', 'editor.decorations'],
      ['editor.read', 'editor.decorations'],
    ]);
  });

  it('rejects raw executable or prototype-shaped editor payloads', () => {
    const result = validateBrowserEditorSandboxContributions([
      {
        ...contribution(),
        onRender: () => undefined,
      },
      {
        ...contribution({ id: 'test-plugin:range:2' }),
        nested: new Date('2026-06-25T00:00:00.000Z'),
      },
    ]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((item) => item.code)).toEqual(['unsafe-shape', 'unsafe-shape']);
  });

  it('keeps Obsidian catalog previews unmounted until a MindOS grant exists', () => {
    const result = validateBrowserEditorSandboxContributions([
      {
        ...contribution(),
        source: 'obsidian-catalog-preview',
      },
    ]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        code: 'source-not-mountable',
        reason: expect.stringContaining('Only MindOS-signed'),
      }),
    ]);
  });

  it('rejects unknown editor permissions instead of silently narrowing them', () => {
    const result = validateBrowserEditorSandboxContributions([
      {
        ...contribution(),
        permissionGrant: {
          ...permissionGrant,
          permissions: ['editor.read', 'editor.decorations', 'editor.write'],
        },
      },
    ]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        code: 'unknown-permission',
        reason: expect.stringContaining('unknown editor permission'),
      }),
    ]);
  });

  it('rejects contributions outside the current document bounds', () => {
    const result = validateBrowserEditorSandboxContributions([
      contribution({ from: 0, to: 99 }),
      contribution({
        id: 'test-plugin:line:99',
        kind: 'line-highlight',
        line: 99,
      }),
    ], {
      documentLength: 10,
      lineCount: 2,
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((item) => item.code)).toEqual(['range-out-of-bounds', 'line-out-of-bounds']);
  });

  it('collects CodeMirror decoration specs only for accepted contributions', () => {
    const state = EditorState.create({ doc: 'alpha\nbeta\ncharlie' });
    const specs = collectBrowserEditorSandboxDecorationSpecs(state, [
      contribution({ id: 'test-plugin:range:1', from: 0, to: 5, tone: 'warning' }),
      contribution({ id: 'test-plugin:line:2', kind: 'line-highlight', line: 2, tone: 'muted' }),
      {
        ...contribution({ id: 'test-plugin:raw:1' }),
        source: 'obsidian-catalog-preview',
      },
    ] as BrowserEditorSandboxContribution[]);

    expect(specs).toEqual([
      expect.objectContaining({
        id: 'test-plugin:range:1',
        type: 'range',
        className: 'cm-mindos-sandbox-range cm-mindos-sandbox-range-warning',
        from: 0,
        to: 5,
      }),
      expect.objectContaining({
        id: 'test-plugin:line:2',
        type: 'line',
        className: 'cm-mindos-sandbox-line cm-mindos-sandbox-line-muted',
        from: 6,
      }),
    ]);
  });
});
