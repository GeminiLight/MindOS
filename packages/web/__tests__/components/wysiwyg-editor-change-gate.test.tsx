// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WysiwygEditor from '@/components/WysiwygEditor';

const milkdownMocks = vi.hoisted(() => ({
  markdownUpdatedHandlers: [] as Array<(_ctx: unknown, markdown: string) => void>,
}));

vi.mock('@milkdown/crepe', () => ({
  CrepeFeature: { CodeMirror: 'CodeMirror' },
  Crepe: class MockCrepe {
    on(register: (listener: { markdownUpdated: (handler: (_ctx: unknown, markdown: string) => void) => void }) => void) {
      register({
        markdownUpdated: (handler) => {
          milkdownMocks.markdownUpdatedHandlers.push(handler);
        },
      });
    }
  },
}));

vi.mock('@milkdown/react', () => {
  const React = require('react') as typeof import('react');

  return {
    MilkdownProvider: ({ children }: { children: React.ReactNode }) => (
      React.createElement('div', { 'data-testid': 'milkdown-provider' }, children)
    ),
    Milkdown: () => React.createElement('div', { 'data-testid': 'milkdown-editor' }),
    useEditor: (factory: (root: HTMLElement) => unknown) => {
      React.useLayoutEffect(() => {
        factory(document.createElement('div'));
      }, []);
    },
  };
});

vi.mock('@/lib/stores/editor-theme-store', () => ({
  useEditorTheme: () => 'default',
}));

describe('WysiwygEditor change gate', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    milkdownMocks.markdownUpdatedHandlers = [];
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  async function renderEditor(onChange = vi.fn()) {
    await act(async () => {
      root.render(<WysiwygEditor value="# Body" onChange={onChange} />);
    });
    expect(milkdownMocks.markdownUpdatedHandlers).toHaveLength(1);
    const wrapper = host.querySelector('.wysiwyg-wrapper');
    expect(wrapper).not.toBeNull();
    return { onChange, wrapper: wrapper as HTMLElement };
  }

  it('suppresses the editor initialization markdown update', async () => {
    const { onChange } = await renderEditor();

    await act(async () => {
      milkdownMocks.markdownUpdatedHandlers[0]({}, '# Body\n');
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits markdown changes after text editing intent', async () => {
    const { onChange, wrapper } = await renderEditor();

    await act(async () => {
      milkdownMocks.markdownUpdatedHandlers[0]({}, '# Body\n');
    });
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      milkdownMocks.markdownUpdatedHandlers[0]({}, '# Bodya');
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('# Bodya');
  });

  it('allows pointer-driven toolbar changes only after the editor is ready', async () => {
    const { onChange, wrapper } = await renderEditor();

    await act(async () => {
      wrapper.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      milkdownMocks.markdownUpdatedHandlers[0]({}, '# Body\n');
    });
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      wrapper.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      milkdownMocks.markdownUpdatedHandlers[0]({}, '**# Body**');
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('**# Body**');
  });
});
