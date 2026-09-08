// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { BrowserMarkdownDom } from '@/lib/obsidian-compat/browser-host/markdown-dom';

it('retires replaced subtrees on every refresh instead of retaining their ownership forever', () => {
  const dom = new BrowserMarkdownDom(); const target = document.createElement('section'); const fragment = document.createElement('div');
  fragment.innerHTML = '<p>initial</p>'; dom.publish(target, fragment);
  for (let i = 0; i < 100; i++) {
    const old = target.firstChild!; const oldText = old.firstChild!;
    const next = document.createElement('p'); next.textContent = String(i); old.replaceWith(next);
    expect(dom.owns(next)).toBe(true); expect(dom.owns(old)).toBe(false); expect(dom.owns(oldText)).toBe(false);
  }
  dom.dispose(); expect(target.childNodes.length).toBe(0);
});

it('keeps ownership of nodes reparented into a different detached container in the same mutation batch', () => {
  const dom = new BrowserMarkdownDom(); const target = document.createElement('section'); const fragment = document.createElement('div');
  fragment.innerHTML = '<p><strong>keep</strong></p>'; dom.publish(target, fragment);
  const paragraph = target.querySelector('p')!; const strong = paragraph.firstChild!; const destination = document.createElement('span');
  destination.appendChild(strong); paragraph.remove();
  expect(dom.owns(strong)).toBe(true); expect(dom.owns(paragraph)).toBe(false);
  dom.dispose(); expect(destination.childNodes.length).toBe(0);
});

it('does not keep observing new nodes after disposal', () => {
  const dom = new BrowserMarkdownDom(); const target = document.createElement('section'); const fragment = document.createElement('div');
  fragment.innerHTML = '<p>before</p>'; dom.publish(target, fragment); dom.dispose();
  const next = target.appendChild(document.createElement('p'));
  expect(dom.owns(next)).toBe(false); dom.dispose(); expect(target.firstChild).toBe(next);
});

it('does not rescan the document during ownership lookups when the DOM has not changed', () => {
  const dom = new BrowserMarkdownDom(); const target = document.createElement('section'); const fragment = document.createElement('div');
  fragment.innerHTML = '<p>value</p>'.repeat(100); dom.publish(target, fragment);
  const getRoot = vi.spyOn(Node.prototype, 'getRootNode');
  try {
    for (const section of target.children) expect(dom.owns(section)).toBe(true);
    expect(getRoot.mock.calls.length).toBe(0);
  } finally { getRoot.mockRestore(); dom.dispose(); }
});
