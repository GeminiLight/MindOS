// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownEditor from '@/components/MarkdownEditor';

vi.mock('next/dynamic', () => ({
  default: () => function MockWysiwygEditor() {
    return <div data-testid="wysiwyg-editor" />;
  },
}));

vi.mock('@/components/EditorWrapper', () => ({
  default: ({ value }: { value: string }) => (
    <textarea data-testid="source-editor" readOnly value={value} />
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

  async function render(value: string, viewMode: 'wysiwyg' | 'source') {
    await act(async () => {
      root.render(<MarkdownEditor value={value} viewMode={viewMode} onChange={vi.fn()} />);
    });
  }

  it('does not mount WYSIWYG when markdown has YAML frontmatter', async () => {
    await render('---\ntype: sop\nstatus: active\n---\n\n# Body', 'wysiwyg');

    expect(host.querySelector('[data-testid="wysiwyg-editor"]')).toBeNull();
    expect(host.querySelector('[data-testid="source-editor"]')).not.toBeNull();
  });

  it('keeps WYSIWYG available for markdown without leading frontmatter', async () => {
    await render('# Body\n\n---\n\nDivider', 'wysiwyg');

    expect(host.querySelector('[data-testid="wysiwyg-editor"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="source-editor"]')).toBeNull();
  });
});
