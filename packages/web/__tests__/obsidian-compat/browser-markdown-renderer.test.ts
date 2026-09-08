// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Component } from '@/lib/obsidian-compat/component';
import * as rendering from '@/lib/obsidian-compat/browser-host/markdown-renderer';

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
const target = () => document.body.appendChild(document.createElement('section'));
const owner = () => ({ assertActive() {} });

it('exposes a direct paragraph that original compact renderers can unwrap without losing cleanup ownership', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target(); const component = new Component();
  await component.load(); await renderer.render('**中文 📚**', el, 'a.md', component);
  const paragraph = el.querySelector(':scope > p');
  expect(paragraph).not.toBeNull(); expect(el.children.length).toBe(1);
  while (paragraph!.firstChild) el.appendChild(paragraph!.firstChild);
  paragraph!.remove();
  expect(el.querySelector(':scope > strong')?.textContent).toBe('中文 📚');
  await component.unload(); expect(el.childNodes.length).toBe(0); await renderer.destroy();
});

it('passes live document sections to postprocessors without a synthetic wrapper', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target(); const sections: HTMLElement[] = [];
  renderer.registerPostProcessor(owner(), section => { sections.push(section); });
  await renderer.render('# Heading\n\nParagraph', el, 'a.md');
  expect(sections.map(section => section.tagName)).toEqual(['H1', 'P']);
  expect(sections.every(section => section.parentElement === el)).toBe(true);
  sections[1].textContent = 'refreshed after render';
  expect(el.querySelector(':scope > p')?.textContent).toBe('refreshed after render');
  await renderer.destroy(); expect(el.childNodes.length).toBe(0);
});

it('reports source positions for native sections after frontmatter while rejecting foreign elements', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target(); const info: unknown[] = [];
  const source = '---\nscore: 3\n---\n# Heading\n\nParagraph [link][ref]\n\n[ref]: https://example.com';
  renderer.registerPostProcessor(owner(), (section, ctx) => {
    info.push(ctx.getSectionInfo(section));
    expect(ctx.getSectionInfo(document.createElement('p'))).toBeNull();
    if (section.querySelector('a')) expect(ctx.getSectionInfo(section.querySelector('a')!)).toEqual(ctx.getSectionInfo(section));
  });
  await renderer.render(source, el, 'a.md');
  expect(info).toEqual([{ text: source, lineStart: 3, lineEnd: 3 }, { text: source, lineStart: 5, lineEnd: 5 }]);
  expect(el.querySelector('a')?.getAttribute('href')).toBe('https://example.com'); await renderer.destroy();
});

it('maps tables, lists and code sections without counting sanitized raw HTML as a rendered section', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target(); const info: unknown[] = [];
  const source = '<script>bad()</script>\n\n- first\n- second\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```sample\nx\n```';
  renderer.registerCodeBlock(owner(), 'sample', (_source, block) => { block.textContent = 'custom'; });
  renderer.registerPostProcessor(owner(), (section, ctx) => { info.push([section.tagName, ctx.getSectionInfo(section)]); });
  await renderer.render(source, el, 'a.md');
  expect(info).toEqual([
    ['UL', { text: source, lineStart: 2, lineEnd: 3 }],
    ['TABLE', { text: source, lineStart: 5, lineEnd: 7 }],
    ['DIV', { text: source, lineStart: 9, lineEnd: 11 }],
  ]);
  expect(el.querySelector('script')).toBeNull(); await renderer.destroy();
});

it('cleans asynchronously replaced section nodes but preserves unrelated siblings', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target();
  await renderer.render('before', el, 'a.md');
  const paragraph = el.querySelector(':scope > p'); expect(paragraph).not.toBeNull();
  const replacement = document.createElement('span'); replacement.textContent = 'after'; paragraph!.replaceWith(replacement);
  const unrelated = el.appendChild(document.createElement('button')); unrelated.textContent = 'host control';
  await renderer.clear(el); expect(el.childNodes.length).toBe(1); expect(el.firstChild).toBe(unrelated);
  await renderer.destroy();
});

it('ties nested Markdown renders to their component without letting an old owner clear a replacement', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target(); const a = new Component(); const b = new Component();
  await a.load(); await b.load();
  await renderer.render('**first**', el, 'first.md', a);
  expect(el.querySelector('strong')?.textContent).toBe('first');
  await renderer.render('*second*', el, 'second.md', b); await a.unload();
  expect(el.querySelector('em')?.textContent).toBe('second');
  await b.unload(); expect(el.childElementCount).toBe(0); await renderer.destroy();
});

it('detaches sections without dismantling child DOM before its unload hook can dispose widgets', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target(); let cleaned = false;
  renderer.registerCodeBlock(owner(), 'widget', (_source, block, ctx) => {
    ctx.addChild(new class extends rendering.BrowserMarkdownRenderChild {
      onload() { this.containerEl.appendChild(document.createElement('button')); }
      onunload() {
        expect(this.containerEl.isConnected).toBe(false);
        const button = this.containerEl.querySelector('button'); expect(button).not.toBeNull();
        this.containerEl.removeChild(button!); cleaned = true;
      }
    }(block));
  });
  await renderer.render('```widget\nvalue\n```', el, 'a.md'); await renderer.clear(el);
  expect(cleaned).toBe(true); await renderer.destroy();
});

it('rejects rendering for an unloaded component and clears an in-flight render when its component closes', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target(); const closed = new Component(); await closed.unload();
  await expect(renderer.render('late', el, 'a.md', closed)).rejects.toThrow(/closed/i);
  const component = new Component(); await component.load();
  let resume!: () => void; let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  renderer.registerPostProcessor(owner(), async () => { enter(); await new Promise<void>(resolve => { resume = resolve; }); });
  const renderingNow = renderer.render('pending', el, 'a.md', component); const rejected = expect(renderingNow).rejects.toThrow(/closed|replaced/i);
  await entered; await component.unload(); resume(); await rejected;
  expect(el.childElementCount).toBe(0); await renderer.destroy();
});

it('renders Markdown and runs original-style codeblock processors with source context and live children', async () => {
  expect(rendering.BrowserMarkdownRenderer).toBeTypeOf('function');
  const renderer = new rendering.BrowserMarkdownRenderer(); const plugin = owner(); const el = target(); const calls: string[] = [];
  renderer.registerCodeBlock(plugin, 'query', (source, block, ctx) => {
    expect(source).toBe('LIST'); expect(ctx.sourcePath).toBe('Notes/中文.md');
    expect(ctx.getSectionInfo(block)).toEqual({ text: '# Title\n\n```query\nLIST\n```', lineStart: 2, lineEnd: 4 });
    ctx.addChild(new class extends rendering.BrowserMarkdownRenderChild {
      onload() { this.containerEl.textContent = 'query output'; calls.push('load'); }
      onunload() { calls.push('unload'); }
    }(block));
  });
  await renderer.render('# Title\n\n```query\nLIST\n```', el, 'Notes/中文.md');
  expect(el.querySelector('h1')?.textContent).toBe('Title'); expect(el.textContent).toContain('query output'); expect(calls).toEqual(['load']);
  await renderer.clear(el); expect(calls).toEqual(['load', 'unload']);
});

it('runs Markdown postprocessors by mutable sortOrder and leaves unknown code fences as code', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const plugin = owner(); const el = target(); const order: string[] = [];
  const later = renderer.registerPostProcessor(plugin, () => { order.push('later'); }); later.sortOrder = 20;
  const earlier = renderer.registerPostProcessor(plugin, () => { order.push('earlier'); }); earlier.sortOrder = -10;
  await renderer.render('```unknown\nx < y\n```', el, 'a.md');
  expect(order).toEqual(['earlier', 'later']); expect(el.querySelector('pre code')?.textContent).toBe('x < y\n');
  await renderer.destroy();
});

it('sanitizes source HTML and JavaScript links while preserving Unicode, tables and empty documents', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target();
  await renderer.render('[bad](javascript:alert(1))\n\n<script>attack()</script>\n\n| 名字 | 值 |\n| --- | --- |\n| 📝 | 1 |', el, 'a.md');
  expect(el.querySelector('script')).toBeNull(); expect(el.querySelector('[href^="javascript:"]')).toBeNull();
  expect(el.querySelector('table')?.textContent).toContain('📝');
  await renderer.render('', el, 'a.md'); expect(el.textContent).toBe(''); await renderer.destroy();
});

it('rebuilds a preview when an owner is removed while retaining the other plugin processor', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const a = owner(); const b = owner(); const el = target(); const calls: string[] = [];
  for (const [plugin, name] of [[a, 'a'], [b, 'b']] as const) renderer.registerPostProcessor(plugin, (_block, ctx) => {
    ctx.addChild(new class extends Component { onunload() { calls.push(name); } }());
  });
  await renderer.render('first', el, 'a.md'); await renderer.removeOwner(a); expect(calls).toEqual(['a', 'b']);
  await renderer.render('next', el, 'a.md'); expect(calls).toEqual(['a', 'b', 'b']);
  await renderer.destroy(); expect(calls).toEqual(['a', 'b', 'b', 'b']);
});

it('cleans all children when a processor fails and rejects late children after its render is gone', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const plugin = owner(); const el = target(); let context: any; let unloaded = 0;
  renderer.registerPostProcessor(plugin, (_block, ctx) => {
    context = ctx; ctx.addChild(new class extends Component { onunload() { unloaded++; } }());
    throw new Error('query failed');
  });
  await expect(renderer.render('doc', el, 'a.md')).rejects.toThrow('query failed'); expect(unloaded).toBe(1);
  expect(() => context.addChild(new Component())).toThrow(/closed/i);
  await renderer.destroy();
});

it('does not publish a stale asynchronous render over a newer document', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const plugin = owner(); const el = target(); let resume!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  renderer.registerPostProcessor(plugin, async (block) => {
    if (block.textContent?.trim() === 'first') { entered(); await new Promise<void>(resolve => { resume = resolve; }); block.textContent = 'stale result'; }
  });
  const first = renderer.render('first', el, 'a.md'); const failed = expect(first).rejects.toThrow(/replaced|closed/i);
  await started; await renderer.render('second', el, 'a.md'); resume(); await failed;
  expect(el.textContent?.trim()).toBe('second'); await renderer.destroy();
});

it('bounds a non-returning processor without hanging cleanup', async () => {
  vi.useFakeTimers(); const renderer = new rendering.BrowserMarkdownRenderer({ timeoutMs: 20 });
  renderer.registerPostProcessor(owner(), () => new Promise(() => {}));
  const done = expect(renderer.render('doc', target(), 'a.md')).rejects.toThrow(/timed out/i);
  await vi.advanceTimersByTimeAsync(21); await done; await renderer.destroy();
});

it('waits for children added during another child asynchronous load and reports their failure', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target(); const cleaned: string[] = [];
  renderer.registerPostProcessor(owner(), (_block, ctx) => {
    ctx.addChild(new class extends Component {
      async onload() {
        await new Promise(resolve => setTimeout(resolve, 0));
        ctx.addChild(new class extends Component {
          async onload() { await new Promise(resolve => setTimeout(resolve, 0)); throw new Error('nested child failed'); }
          onunload() { cleaned.push('nested'); }
        }());
      }
      onunload() { cleaned.push('parent'); }
    }());
  });
  await expect(renderer.render('doc', el, 'a.md')).rejects.toThrow('nested child failed');
  expect(cleaned).toEqual(['parent', 'nested']); expect(el.childElementCount).toBe(0);
  await renderer.destroy();
});

it('provides parsed frontmatter without rendering it and retains original document line numbers', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target();
  const source = '---\ntitle: 中文\ntags: [one, two]\n---\n\n```query\nLIST\n```';
  renderer.registerCodeBlock(owner(), 'query', (_source, block, ctx) => {
    expect(ctx.frontmatter).toEqual({ title: '中文', tags: ['one', 'two'] });
    expect(ctx.getSectionInfo(block)).toEqual({ text: source, lineStart: 5, lineEnd: 7 });
    block.textContent = 'result';
  });
  await renderer.render(source, el, 'a.md'); expect(el.textContent?.trim()).toBe('result'); await renderer.destroy();
});

it('rejects invalid frontmatter and oversize documents without altering the current preview', async () => {
  const renderer = new rendering.BrowserMarkdownRenderer(); const el = target();
  await renderer.render('safe', el, 'a.md');
  await expect(renderer.render('字'.repeat(1024 * 1024), el, 'a.md')).rejects.toThrow(/limit/i);
  expect(el.textContent?.trim()).toBe('safe');
  await expect(renderer.render('---\nbroken: [\n---\nnew', el, 'a.md')).rejects.toThrow(/frontmatter/i);
  await renderer.destroy();
});
