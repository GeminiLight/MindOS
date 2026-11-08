// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { focusPreparedDraft } from '@/lib/focus-if-available';
const text = Array.from({ length: 14 }, (_, i) => `资料 ${i}`).join('\n');
afterEach(() => document.body.replaceChildren());
function input(value = text) {
  const el = document.createElement('textarea');
  el.value = value;
  el.setSelectionRange(value.length, value.length);
  el.scrollTop = 200;
  document.body.append(el);
  return el;
}
it('shows the beginning of a long prepared draft without changing its text', () => {
  const el = input();
  focusPreparedDraft(el, text);
  expect(el.value).toBe(text);
  expect(el.selectionStart).toBe(0);
  expect(el.scrollTop).toBe(0);
  expect(document.activeElement).toBe(el);
});
it('keeps the insertion point when the user already changed the draft', () => {
  const el = input(text + '我的修改');
  const before = el.selectionStart;
  focusPreparedDraft(el, text);
  expect(el.selectionStart).toBe(before);
});
it('does not move focus into a hidden or detached composer', () => {
  const el = input();
  el.setAttribute('inert', '');
  focusPreparedDraft(el, text);
  expect(document.activeElement).not.toBe(el);
  expect(el.selectionStart).toBe(text.length);
  el.remove();
  focusPreparedDraft(el, text);
  expect(el.selectionStart).toBe(text.length);
});
it('keeps short prepared prompts ready to append', () => {
  const el = input('继续整理');
  focusPreparedDraft(el, '继续整理');
  expect(el.selectionStart).toBe(el.value.length);
});
