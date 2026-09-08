// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { focusIfAvailable } from '@/lib/focus-if-available';
afterEach(() => { document.body.innerHTML = ''; });
it('focuses a connected input on the normal path', () => {
  const input = document.createElement('textarea'); document.body.append(input);
  focusIfAvailable(input); expect(document.activeElement).toBe(input);
});
it.each(['inert', 'aria-hidden'])('does not steal focus from a modal when the target ancestor is %s', attribute => {
  const outside = document.createElement('main'); outside.setAttribute(attribute, attribute === 'inert' ? '' : 'true');
  const input = document.createElement('textarea'); outside.append(input);
  const close = document.createElement('button'); document.body.append(outside, close); close.focus();
  focusIfAvailable(input); expect(document.activeElement).toBe(close);
});
it('ignores null and detached targets', () => {
  const current = document.createElement('button'); document.body.append(current); current.focus();
  focusIfAvailable(null); focusIfAvailable(document.createElement('textarea')); expect(document.activeElement).toBe(current);
});
it('does not let initial autofocus replace a focus choice made during loading', () => {
  const main = document.createElement('main'); main.tabIndex = -1;
  const input = document.createElement('textarea'); main.append(input); document.body.append(main); main.focus();
  focusIfAvailable(input, true); expect(document.activeElement).toBe(main);
  focusIfAvailable(input); expect(document.activeElement).toBe(input);
});
