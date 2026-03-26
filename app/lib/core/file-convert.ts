import path from 'path';

export const ALLOWED_IMPORT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.pdf',
]);

export interface ConvertResult {
  content: string;
  originalName: string;
  targetName: string;
  metadata?: Record<string, string>;
}

export function sanitizeFileName(name: string): string {
  let base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  base = base.replace(/\.\./g, '').replace(/^\/+/, '');
  base = base.replace(/[\\:*?"<>|]/g, '-');
  base = base.replace(/-{2,}/g, '-');
  base = base.replace(/^[-\s]+|[-\s]+$/g, '');
  return base || 'imported-file';
}

export function titleFromFileName(name: string): string {
  const ext = path.extname(name);
  const stem = (ext ? name.slice(0, -ext.length) : name).replace(/^\.+/, '');
  const words = stem.replace(/[-_]+/g, ' ').trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && !words[0])) return 'Untitled';
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function convertToMarkdown(fileName: string, rawContent: string): ConvertResult {
  const originalName = fileName;
  const ext = path.extname(fileName).toLowerCase();
  const stem = path.basename(fileName, ext) || 'note';
  const title = titleFromFileName(fileName);

  if (ext === '.md' || ext === '.markdown') {
    return { content: rawContent, originalName, targetName: sanitizeFileName(fileName) };
  }

  if (ext === '.csv' || ext === '.json') {
    return { content: rawContent, originalName, targetName: sanitizeFileName(fileName) };
  }

  if (ext === '.txt') {
    return {
      content: `# ${title}\n\n${rawContent}`,
      originalName,
      targetName: sanitizeFileName(`${stem}.md`),
    };
  }

  if (ext === '.yaml' || ext === '.yml') {
    return {
      content: `# ${title}\n\n\`\`\`yaml\n${rawContent}\n\`\`\`\n`,
      originalName,
      targetName: sanitizeFileName(`${stem}.md`),
    };
  }

  if (ext === '.html' || ext === '.htm') {
    const text = stripHtmlTags(rawContent);
    return {
      content: `# ${title}\n\n${text}\n`,
      originalName,
      targetName: sanitizeFileName(`${stem}.md`),
    };
  }

  if (ext === '.xml') {
    return {
      content: `# ${title}\n\n\`\`\`xml\n${rawContent}\n\`\`\`\n`,
      originalName,
      targetName: sanitizeFileName(`${stem}.md`),
    };
  }

  return {
    content: `# ${title}\n\n${rawContent}`,
    originalName,
    targetName: sanitizeFileName(`${stem}.md`),
  };
}
