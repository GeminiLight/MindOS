import { describe, expect, it } from 'vitest';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';
import { createObsidianElement } from '@/lib/obsidian-compat/shims/dom';
import { analyzePluginCompatibility } from '@/lib/obsidian-compat/compatibility-report';

describe('Obsidian sanitizeHTMLToDom compatibility', () => {
  it('strips tags while keeping visible text content', () => {
    const { sanitizeHTMLToDom } = createObsidianModule();
    const fragment = sanitizeHTMLToDom('<p>Hello <b>world</b></p>');
    expect(fragment.textContent).toBe('Hello world');
    expect(fragment.querySelectorAll('*')).toEqual([]);
  });

  it('removes script and style blocks together with their contents', () => {
    const { sanitizeHTMLToDom } = createObsidianModule();
    const fragment = sanitizeHTMLToDom('<div>keep</div><script>alert("x")</script><style>.a{color:red}</style>');
    expect(fragment.textContent).toBe('keep');
  });

  it('removes HTML comments and event-handler attributes never survive', () => {
    const { sanitizeHTMLToDom } = createObsidianModule();
    const fragment = sanitizeHTMLToDom('<!-- note --><img src="x" onerror="alert(1)">after');
    expect(fragment.textContent).toBe('after');
    expect(fragment.querySelectorAll('*')).toEqual([]);
  });

  it('decodes the common HTML entities in decoding order', () => {
    const { sanitizeHTMLToDom } = createObsidianModule();
    expect(sanitizeHTMLToDom('&lt;b&gt;bold&lt;/b&gt;').textContent).toBe('<b>bold</b>');
    expect(sanitizeHTMLToDom('a&amp;b &quot;q&quot; &#39;s&#39;').textContent).toBe('a&b "q" \'s\'');
    expect(sanitizeHTMLToDom('a&nbsp;b').textContent).toBe('a b');
  });

  it('handles empty and non-string input without throwing', () => {
    const { sanitizeHTMLToDom } = createObsidianModule();
    expect(sanitizeHTMLToDom('').textContent).toBe('');
    expect(sanitizeHTMLToDom(null as unknown as string).textContent).toBe('');
    expect(sanitizeHTMLToDom(undefined as unknown as string).textContent).toBe('');
  });

  it('keeps unicode and emoji text intact', () => {
    const { sanitizeHTMLToDom } = createObsidianModule();
    expect(sanitizeHTMLToDom('<p>中文 🎉 naïve</p>').textContent).toBe('中文 🎉 naïve');
  });

  it('supports appending the fragment into containers without throwing', () => {
    const { sanitizeHTMLToDom } = createObsidianModule();
    const container = createObsidianElement('div');
    let appended: unknown = null;
    expect(() => {
      appended = container.appendChild(sanitizeHTMLToDom('<span>ok</span>'));
    }).not.toThrow();
    expect((appended as { textContent: string }).textContent).toBe('ok');
  });

  it('classifies sanitizeHTMLToDom as a supported API', () => {
    const report = analyzePluginCompatibility('const { sanitizeHTMLToDom } = require("obsidian"); sanitizeHTMLToDom("<b>x</b>");');
    expect(report.obsidianApis).toContain('sanitizeHTMLToDom');
    expect(report.unsupportedApis).not.toContain('sanitizeHTMLToDom');
    expect(report.partialApis).toContain('sanitizeHTMLToDom');
  });
});
