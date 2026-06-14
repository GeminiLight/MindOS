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
  let codeElement: ObsidianElement | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const fenceMatch = line.match(/^(```|~~~)/);
    if (fenceMatch) {
      if (inFence) {
        codeElement?.createEl('code', { text: codeLines.join('\n') });
        codeLines = [];
        codeElement = null;
        inFence = false;
      } else {
        codeElement = element.createEl('pre');
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
    codeElement.createEl('code', { text: codeLines.join('\n') });
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
