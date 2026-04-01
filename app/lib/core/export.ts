import fs from 'fs';
import path from 'path';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';

/** Convert wiki-links [[target]] → relative HTML links */
export function convertWikiLinks(content: string, _currentPath: string): string {
  return content.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_match, target: string, display?: string) => {
    const label = display ?? target;
    const href = target.replace(/\s+/g, '%20');
    return `<a href="${href}.html">${label}</a>`;
  });
}

/** Convert markdown to a complete standalone HTML document */
export async function markdownToHTML(content: string, title: string, currentPath = ''): Promise<string> {
  // Convert wiki-links first
  const processed = convertWikiLinks(content, currentPath);

  const result = await remark()
    .use(remarkGfm)
    .use(remarkHtml, { sanitize: false })
    .process(processed);

  const body = String(result);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 720px;
      margin: 2rem auto;
      padding: 0 1.5rem;
      line-height: 1.7;
      color: #1a1a1a;
      background: #fff;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e0e0e0; background: #1a1a1a; }
      a { color: #6eb5ff; }
      code { background: #2a2a2a; }
      pre { background: #2a2a2a; }
      blockquote { border-color: #444; }
      table, th, td { border-color: #444; }
    }
    h1 { font-size: 1.8rem; font-weight: 700; margin: 2rem 0 1rem; border-bottom: 1px solid #eee; padding-bottom: 0.3rem; }
    h2 { font-size: 1.4rem; font-weight: 600; margin: 1.5rem 0 0.8rem; }
    h3 { font-size: 1.15rem; font-weight: 600; margin: 1.2rem 0 0.5rem; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: 'SF Mono', Menlo, monospace; font-size: 0.875em; background: #f5f5f5; padding: 0.15em 0.4em; border-radius: 3px; }
    pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { margin: 1rem 0; padding: 0.5rem 1rem; border-left: 3px solid #ddd; color: #666; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f8f8f8; font-weight: 600; }
    img { max-width: 100%; height: auto; border-radius: 4px; }
    hr { border: none; border-top: 1px solid #eee; margin: 2rem 0; }
    ul, ol { padding-left: 1.5rem; }
    li { margin: 0.25rem 0; }
    .task-list-item { list-style: none; margin-left: -1.5rem; }
    .task-list-item input { margin-right: 0.5rem; }
    @media print {
      body { max-width: 100%; margin: 0; padding: 1rem; }
      a { color: inherit; text-decoration: underline; }
    }
  </style>
</head>
<body>
${body}
<footer style="margin-top:3rem;padding-top:1rem;border-top:1px solid #eee;font-size:0.75rem;color:#999;">
  Exported from MindOS
</footer>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Collect all exportable files in a directory tree */
export function collectExportFiles(mindRoot: string, dirPath: string): { relativePath: string; content: string }[] {
  const fullDir = path.join(mindRoot, dirPath);
  if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) return [];

  const results: { relativePath: string; content: string }[] = [];
  const SKIP = new Set(['INSTRUCTION.md', '.DS_Store']);

  function walk(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.csv')) {
        try {
          results.push({ relativePath: relPath, content: fs.readFileSync(fullPath, 'utf-8') });
        } catch { /* skip unreadable */ }
      }
    }
  }

  walk(fullDir, '');
  return results;
}
