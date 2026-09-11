import { describe, expect, it, afterEach } from 'vitest';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';
import {
  createMarkdownPostProcessorContext,
  getMarkdownPreviewPostProcessors,
  seedMarkdownPreviewElement,
} from '@/lib/obsidian-compat/shims/markdown-renderer';
import { createObsidianElement } from '@/lib/obsidian-compat/shims/dom';
import { analyzePluginCompatibility } from '@/lib/obsidian-compat/compatibility-report';

describe('Obsidian MarkdownPreviewRenderer compatibility', () => {
  afterEach(() => {
    const { MarkdownPreviewRenderer } = createObsidianModule();
    for (const entry of [...getMarkdownPreviewPostProcessors()]) {
      MarkdownPreviewRenderer.unregisterPostProcessor(entry.processor);
    }
  });

  it('registers and unregisters post processors with stable order metadata', () => {
    const { MarkdownPreviewRenderer } = createObsidianModule();
    const first = () => {};
    const second = () => {};
    MarkdownPreviewRenderer.registerPostProcessor(first, 10);
    MarkdownPreviewRenderer.registerPostProcessor(second, 5);

    const registered = getMarkdownPreviewPostProcessors();
    expect(registered.map(entry => entry.processor)).toEqual([first, second]);
    expect(registered.map(entry => entry.sortOrder)).toEqual([10, 5]);

    MarkdownPreviewRenderer.unregisterPostProcessor(first);
    expect(getMarkdownPreviewPostProcessors().map(entry => entry.processor)).toEqual([second]);
    MarkdownPreviewRenderer.unregisterPostProcessor(first);
    expect(getMarkdownPreviewPostProcessors().map(entry => entry.processor)).toEqual([second]);
  });

  it('defaults the sort order to 100 like the upstream registry', () => {
    const { MarkdownPreviewRenderer } = createObsidianModule();
    const processor = () => {};
    MarkdownPreviewRenderer.registerPostProcessor(processor);
    expect(getMarkdownPreviewPostProcessors()[0].sortOrder).toBe(100);
    MarkdownPreviewRenderer.unregisterPostProcessor(processor);
  });

  it('creates a code block post processor that fires for the matching language', () => {
    const { MarkdownPreviewRenderer } = createObsidianModule();
    const calls: Array<{ source: string; text: string }> = [];
    const wrapper = MarkdownPreviewRenderer.createCodeBlockPostProcessor('js', (source, el) => {
      calls.push({ source, text: (el as unknown as { textContent: string }).textContent ?? '' });
    });

    const preview = createObsidianElement('div');
    seedMarkdownPreviewElement(preview, 'Intro\n```js\nconsole.log(1);\n```\nOutro');
    const codeBlock = preview.children.find(child => String(child.tagName).toLowerCase() === 'pre');
    expect(codeBlock).toBeDefined();

    wrapper(codeBlock as unknown as HTMLElement, createMarkdownPostProcessorContext());
    expect(calls).toEqual([{ source: 'console.log(1);', text: codeBlock?.textContent ?? '' }]);
  });

  it('ignores code blocks of other languages', () => {
    const { MarkdownPreviewRenderer } = createObsidianModule();
    let fired = 0;
    const wrapper = MarkdownPreviewRenderer.createCodeBlockPostProcessor('python', () => {
      fired += 1;
    });

    const preview = createObsidianElement('div');
    seedMarkdownPreviewElement(preview, '```js\nlet x = 1;\n```');
    const codeBlock = preview.children.find(child => String(child.tagName).toLowerCase() === 'pre');
    wrapper(codeBlock as unknown as HTMLElement, createMarkdownPostProcessorContext());
    expect(fired).toBe(0);
  });

  it('classifies MarkdownPreviewRenderer as a supported API', () => {
    const report = analyzePluginCompatibility(
      'const { MarkdownPreviewRenderer } = require("obsidian"); MarkdownPreviewRenderer.registerPostProcessor(p);',
    );
    expect(report.obsidianApis).toContain('MarkdownPreviewRenderer');
    expect(report.unsupportedApis).not.toContain('MarkdownPreviewRenderer');
    expect(report.partialApis).toContain('MarkdownPreviewRenderer');
  });
});
