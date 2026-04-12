#!/usr/bin/env node

/**
 * Standalone Word text extraction script.
 *
 * Supports:
 *   .docx / .docm  — via mammoth.js (Markdown + plain text)
 *   .doc            — via word-extractor (plain text, no Markdown structure)
 *
 * Usage:  node extract-docx.cjs <path-to-word-file>
 * Output: JSON on stdout { text, markdown, extracted, pages, chars, ... }
 *
 * Runs OUTSIDE the Next.js bundler to avoid Turbopack issues.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Suppress console output that would corrupt JSON
const _warn = console.warn;
const _log = console.log;
console.warn = () => {};
console.log = () => {};

// ---------------------------------------------------------------------------
// CJK-aware smart text joining (same as extract-pdf.cjs)
// ---------------------------------------------------------------------------

function isCJK(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x2E80 && c <= 0x2FDF) ||
    (c >= 0x4E00 && c <= 0x9FFF) ||
    (c >= 0x3400 && c <= 0x4DBF) ||
    (c >= 0xF900 && c <= 0xFAFF) ||
    (c >= 0x3040 && c <= 0x309F) ||
    (c >= 0x30A0 && c <= 0x30FF) ||
    (c >= 0xAC00 && c <= 0xD7AF) ||
    (c >= 0x20000 && c <= 0x2FA1F)
  );
}

function isCJKPunct(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x3000 && c <= 0x303F) ||
    (c >= 0xFF01 && c <= 0xFF0F) ||
    (c >= 0xFF1A && c <= 0xFF20) ||
    (c >= 0xFF3B && c <= 0xFF40) ||
    (c >= 0xFF5B && c <= 0xFF65) ||
    (c >= 0xFE50 && c <= 0xFE6B)
  );
}

function shouldAddSpace(left, right) {
  if (!left || !right) return false;
  const lCJK = isCJK(left);
  const rCJK = isCJK(right);
  const lPunct = isCJKPunct(left) || /^[^\w\s]$/.test(left);
  const rPunct = isCJKPunct(right) || /^[^\w\s]$/.test(right);
  if (lPunct || rPunct) return false;
  if (lCJK && rCJK) return false;
  if (lCJK !== rCJK) return true;
  return true;
}

function applyCJKSpacing(text) {
  if (!text || text.length === 0) return text;
  // Process line-by-line to avoid corrupting Markdown syntax lines
  return text
    .split('\n')
    .map((line) => {
      // Skip lines that are Markdown structure (headings, lists, rulers, code fences)
      if (/^#{1,6}\s/.test(line)) return line;
      if (/^\s*[-*+]\s/.test(line)) return line;
      if (/^\s*\d+\.\s/.test(line)) return line;
      if (/^---/.test(line)) return line;
      if (/^```/.test(line)) return line;
      if (/^\|/.test(line)) return line;

      let result = '';
      let prev = '';
      for (const ch of line) {
        if (prev && shouldAddSpace(prev, ch)) {
          result += ' ';
        }
        result += ch;
        prev = ch;
      }
      return result;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtmlEntities(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanText(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function buildResult(text, markdown, imageCount, skipCJKSpacing) {
  // Only apply CJK spacing for .doc (word-extractor) output, not for .docx (mammoth)
  // mammoth already handles spacing correctly in its output
  if (!skipCJKSpacing) {
    text = applyCJKSpacing(text);
    markdown = applyCJKSpacing(markdown);
  }

  const chars = text.length;
  const charLimit = 100000;
  const truncated = chars > charLimit;
  const charsTruncated = truncated ? charLimit : chars;
  const estimatedPages = Math.max(1, Math.ceil(chars / 1500));

  const warnings = [];
  if (imageCount > 0) warnings.push(`含有 ${imageCount} 张图片，仅保留文本`);
  if (truncated) warnings.push(`内容过长，已截断到 ${Math.round(charLimit / 1000)}K 字`);

  return {
    text: truncated ? text.substring(0, charLimit) : text,
    markdown: truncated ? markdown.substring(0, charLimit) : markdown,
    extracted: true,
    pages: estimatedPages,
    chars: chars,
    truncated: truncated,
    charsTruncated: charsTruncated,
    imageCount: imageCount,
    hasCharts: false,
    warning: warnings.length > 0 ? warnings.join('；') : undefined,
  };
}

function errorResult(errorType, message) {
  return {
    text: '',
    markdown: '',
    extracted: false,
    pages: 0,
    chars: 0,
    truncated: false,
    charsTruncated: 0,
    imageCount: 0,
    hasCharts: false,
    error: errorType,
    message: message,
  };
}

// ---------------------------------------------------------------------------
// .docx extraction via mammoth
// ---------------------------------------------------------------------------

async function extractDocx(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.convertToMarkdown({ path: filePath });

  const markdown = result.value || '';

  // For plain text: strip Markdown formatting to get readable text
  const plainText = cleanText(
    markdown
      .replace(/^#{1,6}\s+/gm, '')  // strip heading markers
      .replace(/\*\*([^*]+)\*\*/g, '$1')  // bold
      .replace(/\*([^*]+)\*/g, '$1')  // italic
      .replace(/`([^`]+)`/g, '$1')  // inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links → text only
      .replace(/\\([.!#()\[\]{}*+\-_`~|>])/g, '$1')  // unescape Markdown backslashes
  );

  let imageCount = 0;
  if (result.messages && Array.isArray(result.messages)) {
    imageCount = result.messages.filter(
      (m) => m.message?.includes('image') || m.message?.includes('图')
    ).length;
  }

  return buildResult(plainText, markdown, imageCount, /* skipCJKSpacing */ true);
}

// ---------------------------------------------------------------------------
// .doc extraction via word-extractor
// ---------------------------------------------------------------------------

async function extractDoc(filePath) {
  const WordExtractor = require('word-extractor');
  const extractor = new WordExtractor();
  const doc = await extractor.extract(filePath);

  const body = doc.getBody() || '';
  const footnotes = doc.getFootnotes() || '';
  const endnotes = doc.getEndnotes() || '';

  // Combine all text sections
  let fullText = body;
  if (footnotes.trim()) fullText += '\n\n---\n\n' + footnotes;
  if (endnotes.trim()) fullText += '\n\n---\n\n' + endnotes;

  const plainText = cleanText(fullText);

  // For .doc, we don't get Markdown structure — use plain text as both
  // Add a basic title from filename
  const basename = path.basename(filePath, path.extname(filePath));
  const markdown = `# ${basename}\n\n${plainText}`;

  return buildResult(plainText, markdown, 0, /* skipCJKSpacing */ false);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const filePath = process.argv[2];

  if (!filePath || !fs.existsSync(filePath)) {
    process.stdout.write(JSON.stringify(errorResult('invalid_format', 'File not found')));
    process.exit(0);
  }

  const ext = path.extname(filePath).toLowerCase();

  try {
    let result;

    if (ext === '.doc') {
      result = await extractDoc(filePath);
    } else if (ext === '.docx' || ext === '.docm') {
      result = await extractDocx(filePath);
    } else {
      result = errorResult('invalid_format', '不支持的文件格式');
    }

    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    let errorType = 'corrupted';
    let message = '无法解析此 Word 文档';

    const errMsg = err.message || '';
    if (errMsg.includes('signature') || errMsg.includes('not a valid')) {
      errorType = 'invalid_format';
      message = '文件已损坏或不是有效的 Word 文档';
    } else if (errMsg.includes('timeout')) {
      errorType = 'timeout';
      message = '解析超时，请重试或选择较小文件';
    } else if (errMsg.includes('password')) {
      errorType = 'password_protected';
      message = '此文档受密码保护，无法解析';
    }

    process.stdout.write(JSON.stringify(errorResult(errorType, message)));
    process.exit(0);
  }
}

main().catch(() => {
  process.stdout.write(JSON.stringify(errorResult('corrupted', '解析过程中发生错误')));
  process.exit(0);
});
