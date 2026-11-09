/**
 * Visual harness for the Obsidian data-layer reading view.
 *
 * Renders a sample note through the real remark pipeline and the real
 * globals.css, then screenshots light and dark. Skipped by default so it stays
 * out of `pnpm test`; run it explicitly when touching the markdown pipeline or
 * callout styles:
 *
 *   MINDOS_VISUAL=1 pnpm --filter @mindos/web exec vitest run \
 *     __tests__/markdown/visual-snapshot.test.ts
 *
 * Writes only to /tmp and never touches a knowledge base.
 */
import { describe, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import { VAULT_REMARK_PLUGINS } from '@/components/markdown/VaultMarkdown';

const SAMPLE = `# Obsidian 数据层兼容

普通链接 [[Target Note]]，带别名 [[Target Note|显示文本]]，
带标题 [[Target Note#某个小节]]，块引用 [[Target Note#^abc123]]。
中文与 emoji：[[中文笔记]] [[note 🎉 emoji]]。
（上面这两条在本图中被标成「目标不存在」，用来对照断链样式。）

标签：#project 与嵌套 #work/alpha 与中文 #中文标签。纯数字不算标签：issue #1、#2024。

带块 id 的段落，标记应被隐藏 ^block-1

代码块里的不应变成链接：

\`\`\`ts
const link = '[[Not A Link]]';
\`\`\`

行内代码 \`[[Also Not A Link]]\` 同样跳过。

> [!note] 这是一条 note
> 正文内容，里面还能有链接 [[Target Note]]。

> [!warning] 注意
> 警告类 callout。

> [!danger] 危险
> 危险类 callout。

> [!success] 完成
> 成功类 callout。

> [!tip]- 可折叠的提示
> 带折叠标记。

> 普通引用块保持原样，不是 callout。
`;

const CANVAS = JSON.stringify({
  nodes: [
    { id: 'g1', type: 'group', label: '调研', x: -40, y: -60, width: 420, height: 300, color: '5' },
    { id: 'a', type: 'text', text: '## 现状\n\n两套解析器，语义会漂移。', x: 0, y: 0, width: 220, height: 110 },
    { id: 'b', type: 'text', text: '收敛到**一个**解析器\n\n见 [[spec-obsidian-data-layer-compat]]', x: 0, y: 140, width: 300, height: 110, color: '4' },
    { id: 'c', type: 'file', file: 'Notes/Obsidian.md', subpath: '#数据层', x: 460, y: 0, width: 220, height: 80, color: '3' },
    { id: 'd', type: 'link', url: 'https://jsoncanvas.org', x: 460, y: 140, width: 220, height: 70, color: '6' },
    { id: 'e', type: 'text', text: '风险：`.canvas` 只读', x: 460, y: 270, width: 220, height: 70, color: '1' },
  ],
  edges: [
    { id: 'e1', fromNode: 'a', fromSide: 'bottom', toNode: 'b', toSide: 'top', label: '收敛' },
    { id: 'e2', fromNode: 'a', fromSide: 'right', toNode: 'c', toSide: 'left' },
    { id: 'e3', fromNode: 'b', fromSide: 'right', toNode: 'd', toSide: 'left', color: '6' },
    { id: 'e4', fromNode: 'd', fromSide: 'bottom', toNode: 'e', toSide: 'top', toEnd: 'none' },
  ],
});

describe.skipIf(!process.env.MINDOS_VISUAL)('reading view visual snapshot', () => {
  it('screenshots wiki links and callouts in light and dark', async () => {
    // Playwright is a root-level dev dependency, not resolvable from packages/web.
    const requireFromRoot = createRequire(resolve(process.cwd(), '../../noop.js'));
    const { chromium } = requireFromRoot('@playwright/test') as typeof import('@playwright/test');

    const rendered = renderToStaticMarkup(
      createElement(ReactMarkdown, {
        remarkPlugins: VAULT_REMARK_PLUGINS,
      }, SAMPLE),
    );
    // MarkdownView stamps this attribute on links whose target is missing from
    // the vault. The harness renders ReactMarkdown directly, so apply it here to
    // exercise the real broken-link CSS against real markup.
    const html = rendered
      .replace(
        /(<a [^>]*data-wikilink="(?:中文笔记|note 🎉 emoji)")/g,
        '$1 data-wikilink-unresolved="true"',
      )
      // MarkdownView renders a tag node as a button chip rather than an anchor;
      // mirror that here so the harness exercises the real `.markdown-tag` CSS.
      .replace(/<a [^>]*data-tag="([^"]+)"[^>]*>(.*?)<\/a>/g,
        '<button type="button" class="markdown-tag" data-tag="$1">$2</button>');

    const dir = mkdtempSync(join(tmpdir(), 'mindos-md-visual-'));
    // The browser ignores `@import "tailwindcss"` and `@theme`; the `:root`
    // tokens and `.prose` rules this harness verifies are plain CSS.
    writeFileSync(join(dir, 'globals.css'), readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8'));

    const page = (theme: string) => `<!doctype html>
<html class="${theme}"><head><meta charset="utf-8"><link rel="stylesheet" href="./globals.css"></head>
<body style="background:var(--background);color:var(--foreground);margin:0;padding:32px;font-family:system-ui">
<div class="prose max-w-none" style="max-width:760px">${html}</div>
</body></html>`;

    const browser = await chromium.launch();
    try {
      for (const theme of ['light', 'dark']) {
        writeFileSync(join(dir, `${theme}.html`), page(theme));
        const tab = await browser.newPage({ viewport: { width: 900, height: 1100 } });
        await tab.goto(pathToFileURL(join(dir, `${theme}.html`)).href);
        await tab.screenshot({ path: `/tmp/wikilink-callout-${theme}.png`, fullPage: true });
        await tab.close();
      }
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('screenshots a JSON Canvas board in light and dark', async () => {
    const requireFromRoot = createRequire(resolve(process.cwd(), '../../noop.js'));
    const { chromium } = requireFromRoot('@playwright/test') as typeof import('@playwright/test');
    const { CanvasRenderer } = await import('@/components/renderers/canvas/CanvasRenderer');

    const html = renderToStaticMarkup(
      createElement(CanvasRenderer, {
        filePath: 'Board.canvas', content: CANVAS, extension: 'canvas', saveAction: async () => {},
      }),
    );

    const dir = mkdtempSync(join(tmpdir(), 'mindos-canvas-visual-'));
    writeFileSync(join(dir, 'globals.css'), readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8'));

    const browser = await chromium.launch();
    try {
      for (const theme of ['light', 'dark']) {
        writeFileSync(join(dir, `${theme}.html`), `<!doctype html>
<html class="${theme}"><head><meta charset="utf-8"><link rel="stylesheet" href="./globals.css"></head>
<body style="background:var(--background);color:var(--foreground);margin:0;padding:24px;font-family:system-ui">
${html}
</body></html>`);
        const tab = await browser.newPage({ viewport: { width: 1000, height: 820 } });
        await tab.goto(pathToFileURL(join(dir, `${theme}.html`)).href);
        await tab.screenshot({ path: `/tmp/canvas-${theme}.png`, fullPage: true });
        await tab.close();
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
