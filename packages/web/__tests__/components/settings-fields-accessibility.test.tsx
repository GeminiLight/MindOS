// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Field, Input, PasswordInput, Select } from '@/components/settings/Primitives';
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; HTMLElement.prototype.scrollIntoView = vi.fn(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
it('associates nested controls with field labels and error descriptions', async () => {
  await act(async () => root.render(<Field label="Endpoint" hint="Enter a URL" hintError><div><Input /></div></Field>));
  const input = host.querySelector('input')!;
  expect(document.getElementById(input.getAttribute('aria-labelledby')!)?.textContent).toBe('Endpoint');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a URL');
  expect(input.getAttribute('aria-invalid')).toBe('true');
});
it('lets keyboard users reach the secret visibility control', async () => {
  await act(async () => root.render(<Field label="API key"><PasswordInput value="secret" onChange={() => {}} /></Field>));
  const button = host.querySelector('button')!;
  expect(button.tabIndex).toBe(0);
  await act(async () => button.click());
  expect(host.querySelector('input')?.type).toBe('text');
  expect(button.getAttribute('aria-pressed')).toBe('true');
});
it('announces and selects the keyboard-highlighted option and respects disabled state', async () => {
  const change = vi.fn();
  const view = (disabled = false) => <Field label="Provider"><Select value="a" onChange={change} disabled={disabled}><option value="a">A</option><option value="b">B</option></Select></Field>;
  await act(async () => root.render(view()));
  const button = host.querySelector('[role=combobox]') as HTMLButtonElement;
  for (const key of ['Enter', 'ArrowDown']) await act(async () => button.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true})));
  expect(document.getElementById(button.getAttribute('aria-activedescendant')!)?.textContent).toContain('B');
  await act(async () => button.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})));
  expect(change).toHaveBeenCalledWith({target:{value:'b'}});
  await act(async () => root.render(view(true)));
  expect(button.disabled).toBe(true);
});
