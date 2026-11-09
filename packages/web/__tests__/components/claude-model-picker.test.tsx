// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NativeRuntimeOptionsCapsule from '@/components/ask/NativeRuntimeOptionsCapsule';

/**
 * Codex offers a model list; Claude only had a free-text box, so users had to
 * know an identifier by heart. Aliases are offered instead of pinned ids
 * because they keep resolving to the current model
 * (spec-acp-first-agent-integration Phase 3).
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderClaude(onChange = vi.fn(), value: Record<string, unknown> = {}) {
  act(() => root.render(
    <NativeRuntimeOptionsCapsule runtimeKind="claude" value={value} onChange={onChange} />,
  ));
  return onChange;
}

function openModelDropdown() {
  const button = [...host.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === 'Model');
  act(() => { button!.click(); });
}

function suggestionButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('button[data-model-suggestion]')];
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('Claude model picker', () => {
  it('offers the stable model aliases so a user need not recall an identifier', () => {
    renderClaude();
    openModelDropdown();

    expect(suggestionButtons().map(button => button.textContent?.trim())).toEqual(['sonnet', 'opus', 'haiku']);
  });

  it('applies the alias the user picked', () => {
    const onChange = renderClaude();
    openModelDropdown();
    act(() => { suggestionButtons().find(button => button.textContent?.trim() === 'opus')!.click(); });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ modelOverride: 'opus' }));
  });

  it('marks the alias that is already in use', () => {
    renderClaude(vi.fn(), { modelOverride: 'opus' });
    openModelDropdown();

    const selected = suggestionButtons().filter(button => button.getAttribute('aria-pressed') === 'true');
    expect(selected.map(button => button.textContent?.trim())).toEqual(['opus']);
  });

  it('still accepts a full model id typed by hand', () => {
    const onChange = renderClaude();
    openModelDropdown();
    const input = document.querySelector<HTMLInputElement>('#native-model-claude')!;
    act(() => {
      // React tracks the controlled value internally; the native setter is the
      // only way a synthetic change reaches onChange.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
        .set!.call(input, 'claude-opus-4-20250514');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ modelOverride: 'claude-opus-4-20250514' }));
  });

  it('does not show Claude aliases for Codex, which has its own model list', () => {
    act(() => root.render(
      <NativeRuntimeOptionsCapsule runtimeKind="codex" value={{}} onChange={vi.fn()} />,
    ));
    openModelDropdown();

    expect(suggestionButtons()).toHaveLength(0);
  });
});
