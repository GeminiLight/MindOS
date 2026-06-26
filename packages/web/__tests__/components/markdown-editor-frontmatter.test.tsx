// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownEditor from '@/components/MarkdownEditor';
import type { BrowserEditorSandboxContribution } from '@/lib/obsidian-compat/browser-editor-sandbox';

const sandboxContribution: BrowserEditorSandboxContribution = {
  sandboxVersion: 1,
  id: 'test-plugin:lint:1',
  pluginId: 'test-plugin',
  source: 'mindos-signed',
  kind: 'line-highlight',
  line: 1,
  permissionGrant: {
    scope: 'browser-editor-sandbox',
    grantedBy: 'mindos',
    permissions: ['editor.read', 'editor.decorations'],
  },
};

vi.mock('next/dynamic', () => ({
  default: () => function MockWysiwygEditor({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) {
    const React = require('react') as typeof import('react');
    const initialValue = React.useRef(value);
    return (
      <button
        type="button"
        data-testid="wysiwyg-editor"
        onClick={() => onChange('# Edited')}
      >
        {initialValue.current}
      </button>
    );
  },
}));

vi.mock('@/components/EditorWrapper', () => ({
  default: ({ value, sandboxContributions = [] }: { value: string; sandboxContributions?: unknown[] }) => (
    <textarea data-testid="source-editor" data-sandbox-count={sandboxContributions.length} readOnly value={value} />
  ),
}));

describe('MarkdownEditor frontmatter handling', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  async function render(
    value: string,
    viewMode: 'wysiwyg' | 'source',
    editorKey?: string,
    sandboxContributions: BrowserEditorSandboxContribution[] = [],
    onChange = vi.fn(),
  ) {
    await act(async () => {
      root.render(
        <MarkdownEditor
          value={value}
          viewMode={viewMode}
          onChange={onChange}
          editorKey={editorKey}
          sandboxContributions={sandboxContributions}
        />,
      );
    });
    return { onChange };
  }

  it('opens WYSIWYG for valid frontmatter markdown while preserving the original properties block', async () => {
    const { onChange } = await render('---\ntype: sop\nstatus: active\n---\n\n# Body', 'wysiwyg');

    const editor = host.querySelector<HTMLButtonElement>('[data-testid="wysiwyg-editor"]');
    expect(editor).not.toBeNull();
    expect(editor?.textContent).toBe('# Body');
    expect(host.querySelector('[data-testid="source-editor"]')).toBeNull();

    await act(async () => {
      editor!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('---\ntype: sop\nstatus: active\n---\n\n# Edited');
  });

  it('keeps malformed frontmatter-like notes in source mode', async () => {
    await render('---\ntitle: [broken\n---\n\n# Body', 'wysiwyg');

    expect(host.querySelector('[data-testid="wysiwyg-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="source-editor"]')).not.toBeNull();
  });

  it('keeps WYSIWYG available for markdown without leading frontmatter', async () => {
    await render('# Body\n\n---\n\nDivider', 'wysiwyg');

    expect(host.querySelector('[data-testid="wysiwyg-editor"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="source-editor"]')).toBeNull();
  });

  it('does not mount hidden WYSIWYG while source mode is active', async () => {
    await render('# Body\n\nPlain note', 'source');

    expect(host.querySelector('[data-testid="wysiwyg-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="source-editor"]')).not.toBeNull();
  });

  it('passes browser editor sandbox contributions only to source mode', async () => {
    await render('# Body', 'source', 'source.md', [sandboxContribution]);

    expect(host.querySelector('[data-testid="source-editor"]')?.getAttribute('data-sandbox-count')).toBe('1');

    await render('# Body', 'wysiwyg', 'wysiwyg.md', [sandboxContribution]);

    expect(host.querySelector('[data-testid="wysiwyg-editor"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="source-editor"]')).toBeNull();
  });

  it('remounts WYSIWYG when the editor key changes between markdown files', async () => {
    await render('# First file', 'wysiwyg', 'first.md');
    expect(host.querySelector('[data-testid="wysiwyg-editor"]')?.textContent).toBe('# First file');

    await render('# Second file', 'wysiwyg', 'second.md');
    expect(host.querySelector('[data-testid="wysiwyg-editor"]')?.textContent).toBe('# Second file');
  });
});
