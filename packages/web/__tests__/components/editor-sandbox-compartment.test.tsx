// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Editor from '@/components/Editor';

const sandboxMocks = vi.hoisted(() => ({
  createBrowserEditorSandboxExtension: vi.fn(() => []),
}));

vi.mock('@/lib/editor/browser-editor-sandbox-codemirror', () => ({
  createBrowserEditorSandboxExtension: sandboxMocks.createBrowserEditorSandboxExtension,
}));
vi.mock('@/hooks/useEditorImageUpload', () => ({
  useEditorImageUpload: () => ({ uploadToMedia: vi.fn(), isUploading: false }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('Editor sandbox compartment', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // CodeMirror measures layout; jsdom lacks these Range APIs.
    if (typeof Range !== 'undefined') {
      Range.prototype.getClientRects = Range.prototype.getClientRects ?? (() => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList));
      Range.prototype.getBoundingClientRect = Range.prototype.getBoundingClientRect ?? (() => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect);
    }
    sandboxMocks.createBrowserEditorSandboxExtension.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  it('does not reconfigure the sandbox compartment on every keystroke when no contributions are passed', () => {
    const onChange = vi.fn();
    act(() => { root.render(<Editor value="a" onChange={onChange} />); });
    const callsAfterMount = sandboxMocks.createBrowserEditorSandboxExtension.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    act(() => { root.render(<Editor value="ab" onChange={onChange} />); });
    act(() => { root.render(<Editor value="abc" onChange={onChange} />); });

    expect(sandboxMocks.createBrowserEditorSandboxExtension.mock.calls.length).toBe(callsAfterMount);
  });
});
