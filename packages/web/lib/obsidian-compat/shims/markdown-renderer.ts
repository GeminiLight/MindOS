import { createObsidianElement, type ObsidianElement } from './dom';

export interface MarkdownPostProcessorContextLike {
  sourcePath: string;
  frontmatter: Record<string, unknown> | null;
  getSectionInfo(): null;
  addChild(): void;
}

export function createMarkdownPostProcessorContext(sourcePath = ''): MarkdownPostProcessorContextLike {
  return {
    sourcePath,
    frontmatter: null,
    getSectionInfo: () => null,
    addChild: () => undefined,
  };
}

export function seedMarkdownPreviewElement(element: ObsidianElement, markdown: string): void {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let codeLines: string[] = [];
  let codeLanguage = '';
  let codeElement: ObsidianElement | null = null;

  const finishCodeBlock = () => {
    const attrs = codeLanguage
      ? { text: codeLines.join('\n'), cls: `language-${codeLanguage}` }
      : { text: codeLines.join('\n') };
    codeElement?.createEl('code', attrs);
    codeLines = [];
    codeElement = null;
    codeLanguage = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const fenceMatch = line.match(/^(```|~~~)(.*)$/);
    if (fenceMatch) {
      if (inFence) {
        finishCodeBlock();
        inFence = false;
      } else {
        codeElement = element.createEl('pre');
        codeLanguage = fenceMatch[2].trim();
        inFence = true;
      }
      continue;
    }

    if (inFence) {
      codeLines.push(rawLine);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      element.createEl(`h${heading[1].length}`, { text: heading[2] });
      continue;
    }

    const listItem = trimmed.match(/^[-*+]\s+(.+)$/) ?? trimmed.match(/^\d+\.\s+(.+)$/);
    if (listItem) {
      element.createEl('li', { text: listItem[1] });
      continue;
    }

    element.createEl('p', { text: trimmed });
  }

  if (inFence && codeElement) {
    finishCodeBlock();
  }
}

export function getElementChildren(element: HTMLElement | undefined): HTMLElement[] {
  return Array.from((element as unknown as { children?: Iterable<HTMLElement> } | undefined)?.children ?? []);
}

export function collectElementText(element: HTMLElement | undefined): string {
  if (!element) return '';
  const childText = getElementChildren(element).map(collectElementText).filter(Boolean).join('\n').trim();
  if (childText) return childText;
  return (element.textContent ?? '').trim();
}

export class MarkdownRenderer {
  static async renderMarkdown(
    markdown: string,
    el: HTMLElement,
    sourcePath: string,
    _component?: unknown,
  ): Promise<void> {
    await MarkdownRenderer.render(null, markdown, el, sourcePath, _component);
  }

  static async render(
    _app: unknown,
    markdown: string,
    el: HTMLElement,
    _sourcePath: string,
    _component?: unknown,
  ): Promise<void> {
    const target = (el && typeof (el as unknown as { createEl?: unknown }).createEl === 'function')
      ? el as ObsidianElement
      : createObsidianElement('div');
    seedMarkdownPreviewElement(target, markdown);
    if (target !== el) {
      el.textContent = collectElementText(target);
    }
  }
}

export interface MarkdownPreviewPostProcessorEntry {
  processor: (el: HTMLElement, ctx: unknown) => void;
  sortOrder: number;
}

const MARKDOWN_PREVIEW_DEFAULT_SORT_ORDER = 100;
const markdownPreviewPostProcessors: MarkdownPreviewPostProcessorEntry[] = [];

/**
 * Registered preview post processors in registration order. The MindOS
 * snapshot render pipeline does not invoke them yet; the registry keeps the
 * register/unregister contract observable for the host and for tests.
 */
export function getMarkdownPreviewPostProcessors(): readonly MarkdownPreviewPostProcessorEntry[] {
  return markdownPreviewPostProcessors;
}

function isCodeBlockForLanguage(el: HTMLElement, language: string): boolean {
  for (const child of getElementChildren(el)) {
    if (String(child.tagName).toLowerCase() !== 'code') continue;
    if (child.classList?.contains(`language-${language}`)) return true;
  }
  return false;
}

export class MarkdownPreviewRenderer {
  static registerPostProcessor(postProcessor: (el: HTMLElement, ctx: unknown) => void, sortOrder = MARKDOWN_PREVIEW_DEFAULT_SORT_ORDER): void {
    markdownPreviewPostProcessors.push({ processor: postProcessor, sortOrder });
  }

  static unregisterPostProcessor(postProcessor: (el: HTMLElement, ctx: unknown) => void): void {
    const index = markdownPreviewPostProcessors.findIndex((entry) => entry.processor === postProcessor);
    if (index >= 0) {
      markdownPreviewPostProcessors.splice(index, 1);
    }
  }

  static createCodeBlockPostProcessor(
    language: string,
    handler: (source: string, el: HTMLElement, ctx: unknown) => Promise<unknown> | void,
  ): (el: HTMLElement, ctx: unknown) => void {
    return (el, ctx) => {
      if (!isCodeBlockForLanguage(el, language)) return;
      const code = getElementChildren(el).find((child) => String(child.tagName).toLowerCase() === 'code');
      void handler(code?.textContent ?? '', el, ctx);
    };
  }
}
