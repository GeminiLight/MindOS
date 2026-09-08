// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserMarkdownRenderer } from '@/lib/obsidian-compat/browser-host/markdown-renderer';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
const target = () => document.body.appendChild(document.createElement('section'));

it('renders file links, aliases, headings and block targets as real internal anchors', async () => {
  const renderer = new BrowserMarkdownRenderer(); const el = target();
  await renderer.render('[[Notes/Other.md|第二篇 📚]] [[Other#Heading|section]] [[#^block-id|block]]', el, 'Notes/Here.md');
  const links = [...el.querySelectorAll('a.internal-link')];
  expect(links.map(link => [link.textContent, link.getAttribute('data-href')])).toEqual([
    ['第二篇 📚', 'Notes/Other.md'], ['section', 'Other#Heading'], ['block', '#^block-id'],
  ]);
  await renderer.destroy();
});

it('leaves escaped links, code, incomplete brackets and not-yet-supported embeds literal', async () => {
  const renderer = new BrowserMarkdownRenderer(); const el = target();
  await renderer.render('\\[[Escaped]] `[[Inline]]` ![[Picture.png]] [[Incomplete]\n\n```text\n[[Fenced]]\n```\n\n[[Real]]', el, 'Here.md');
  expect([...el.querySelectorAll('a.internal-link')].map(link => link.textContent)).toEqual(['Real']);
  expect(el.querySelector('code')?.textContent).toBe('[[Inline]]');
  expect(el.textContent).toContain('![[Picture.png]]'); expect(el.textContent).toContain('[[Escaped]]');
  await renderer.destroy();
});

it('keeps wiki link labels and special paths out of executable HTML or external URLs', async () => {
  const renderer = new BrowserMarkdownRenderer(); const el = target();
  await renderer.render('[[javascript:alert(1)|<img src=x onerror=alert(1)>]] [[A & B %20.md|A & B]]', el, 'Here.md');
  const links = [...el.querySelectorAll('a.internal-link')];
  expect(links).toHaveLength(2); expect(links[0].textContent).toBe('<img src=x onerror=alert(1)>');
  expect(links.every(link => link.getAttribute('href')?.startsWith('#'))).toBe(true);
  expect(el.querySelector('img,script,[onerror]')).toBeNull();
  expect(links[1].getAttribute('data-href')).toBe('A & B %20.md');
  // Rendering must not silently grant navigation in an unconfigured host.
  expect(links[0].getAttribute('aria-disabled')).toBe('true');
  expect(links[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false);
  await renderer.destroy();
});

it('renders escaped table aliases without changing the table shape', async () => {
  const renderer = new BrowserMarkdownRenderer(); const el = target();
  await renderer.render('| Page | Value |\n| --- | --- |\n| [[Other\\|Other name]] | 7 |', el, 'Here.md');
  expect(el.querySelectorAll('td')).toHaveLength(2);
  expect(el.querySelector('td a.internal-link')?.textContent).toBe('Other name');
  await renderer.destroy();
});

it('distinguishes escaped exclamation marks from embed syntax and preserves ordinary Markdown links', async () => {
  const renderer = new BrowserMarkdownRenderer(); const el = target();
  await renderer.render(String.raw`\![[Link]] \\![[Embed.png]] [regular](#note) [[A|B & C]]`, el, 'Here.md');
  expect([...el.querySelectorAll('a.internal-link')].map(link => link.textContent)).toEqual(['Link', 'B & C']);
  expect(el.textContent).toContain('![[Embed.png]]');
  expect(el.querySelector('a[href="#note"]')?.classList.contains('internal-link')).toBe(false);
  await renderer.destroy();
});

it('renders in opaque contexts that do not expose the secure-context randomUUID method', async () => {
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('randomUUID is unavailable'); });
  const renderer = new BrowserMarkdownRenderer(); const el = target();
  await renderer.render('[[Other|Other]]', el, 'Here.md');
  expect(el.querySelector('a.internal-link')?.textContent).toBe('Other');
  await renderer.destroy();
});
