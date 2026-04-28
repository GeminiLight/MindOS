/**
 * Space Overview Compiler
 *
 * Reads all files in a Space, sends them to LLM, and generates
 * a structured README.md overview. Uses pi-ai's `complete()` for
 * a single-shot LLM call (no agent session needed).
 */
import fs from 'fs';
import path from 'path';
import { complete } from '@mariozechner/pi-ai';
import { getModelConfig } from '@/lib/agent/model';
import { effectiveAiConfig } from '@/lib/settings';
import { getMindRoot, collectAllFiles, invalidateCache } from '@/lib/fs';
import { resolveSafe } from '@/lib/core/security';

const MAX_FILES = 80;
const MAX_CHARS_PER_FILE = 800;
const MAX_TOTAL_CHARS = 40_000;

export interface CompileResult {
  content: string;
  /** True when no files changed since last compile — README untouched. */
  unchanged?: boolean;
  stats: {
    fileCount: number;
    totalChars: number;
    spaceName: string;
    /** Number of changed files (incremental mode) or total files (full mode). */
    scannedFiles: number;
    mode: 'full' | 'incremental' | 'unchanged';
  };
}

export interface CompileError {
  code: 'no_api_key' | 'no_files' | 'llm_error';
  message: string;
}

function detectLanguage(texts: string[]): 'zh' | 'en' {
  const sample = texts.join(' ').slice(0, 2000);
  const cjkCount = (sample.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  return cjkCount > sample.length * 0.05 ? 'zh' : 'en';
}

function buildPrompt(spaceName: string, files: { name: string; preview: string }[], lang: 'zh' | 'en'): string {
  const fileList = files
    .map(f => `### ${f.name}\n${f.preview}`)
    .join('\n\n');

  if (lang === 'zh') {
    return `你是一位知识库策展人。请分析以下 "${spaceName}" 空间中的文件，生成一份简洁实用的 README.md。

要求：
1. 以 "# ${spaceName}" 作为标题，下面一句话概括这个空间的核心主题
2. 用 "## 核心主题" 列出发现的 3-7 个关键主题（每个用一行 bullet point）
3. 用 "## 重要文件" 列出 3-5 个最重要的文件及其简要说明
4. 用 "## 知识地图" 用 2-3 句话描述这些知识之间的关联和整体脉络
5. 保持简洁（200-400 字），使用 Markdown 格式
6. 不要虚构不存在的内容，严格基于提供的文件内容

空间中的文件（共 ${files.length} 个）：

${fileList}`;
  }

  return `You are a knowledge base curator. Analyze the following files in the "${spaceName}" Space and generate a concise, useful README.md.

Requirements:
1. Start with "# ${spaceName}" as the title, followed by a one-line description of the Space's core theme
2. Add "## Key Topics" with 3-7 key topics found (one bullet point each)
3. Add "## Notable Files" listing 3-5 most important files with brief descriptions
4. Add "## Knowledge Map" with 2-3 sentences describing how these topics connect
5. Keep it concise (200-400 words), use Markdown formatting
6. Do NOT fabricate content — strictly base on the provided file contents

Files in this Space (${files.length} total):

${fileList}`;
}

/**
 * Collect file previews from a Space for LLM input.
 * Exported for testing.
 */
export function collectSpaceFiles(
  mindRoot: string,
  space: string,
): { name: string; preview: string }[] {
  const allFiles = collectAllFiles();
  const prefix = space.endsWith('/') ? space : space + '/';
  const spaceFiles = allFiles
    .filter(f => f.startsWith(prefix))
    .filter(f => /\.(md|csv|txt)$/i.test(f))
    .filter(f => {
      const base = path.basename(f);
      return base !== 'INSTRUCTION.md' && base !== 'CONFIG.json';
    })
    .slice(0, MAX_FILES);

  let totalChars = 0;
  const result: { name: string; preview: string }[] = [];

  for (const filePath of spaceFiles) {
    if (totalChars >= MAX_TOTAL_CHARS) break;
    const abs = path.join(mindRoot, filePath);
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      const trimmed = content.slice(0, MAX_CHARS_PER_FILE);
      const preview = trimmed.length < content.length ? trimmed + '\n...(truncated)' : trimmed;
      totalChars += preview.length;
      const relativeName = filePath.slice(prefix.length);
      result.push({ name: relativeName, preview });
    } catch {
      // skip unreadable files
    }
  }

  return result;
}

// ─── Compile Metadata (stored as HTML comment in README footer) ─────────────

const COMPILE_META_RE = /<!-- mindos:compiled (\S+) files:(\d+) -->/;

/** Threshold: if changed files exceed this ratio, do a full rewrite. */
const INCREMENTAL_THRESHOLD = 0.5;

export interface CompileMeta {
  timestamp: string;   // ISO 8601
  fileCount: number;
}

/** Parse the compile metadata comment from README content. */
export function parseCompileMeta(content: string): CompileMeta | null {
  const match = content.match(COMPILE_META_RE);
  if (!match) return null;
  return { timestamp: match[1], fileCount: parseInt(match[2], 10) };
}

/** Strip existing compile metadata comment from content. */
export function stripCompileMeta(content: string): string {
  return content.replace(/\n?<!-- mindos:compiled \S+ files:\d+ -->\s*$/, '');
}

/** Append compile metadata comment to content. */
export function appendCompileMeta(content: string, meta: CompileMeta): string {
  const cleaned = stripCompileMeta(content).trimEnd();
  return `${cleaned}\n\n<!-- mindos:compiled ${meta.timestamp} files:${meta.fileCount} -->\n`;
}

/**
 * Collect only files modified after a given timestamp.
 * Returns { changed, total } where total is all eligible files count.
 */
export function collectChangedFiles(
  mindRoot: string,
  space: string,
  sinceTimestamp: string,
): { changed: { name: string; preview: string }[]; total: number } {
  const allFiles = collectAllFiles();
  const prefix = space.endsWith('/') ? space : space + '/';
  const spaceFiles = allFiles
    .filter(f => f.startsWith(prefix))
    .filter(f => /\.(md|csv|txt)$/i.test(f))
    .filter(f => {
      const base = path.basename(f);
      return base !== 'INSTRUCTION.md' && base !== 'CONFIG.json' && base !== 'README.md';
    });

  const sinceMs = new Date(sinceTimestamp).getTime();
  const changed: { name: string; preview: string }[] = [];
  let totalChars = 0;

  for (const filePath of spaceFiles) {
    if (changed.length >= MAX_FILES) break;
    if (totalChars >= MAX_TOTAL_CHARS) break;
    const abs = path.join(mindRoot, filePath);
    try {
      const stat = fs.statSync(abs);
      if (stat.mtimeMs <= sinceMs) continue;
      const content = fs.readFileSync(abs, 'utf-8');
      const trimmed = content.slice(0, MAX_CHARS_PER_FILE);
      const preview = trimmed.length < content.length ? trimmed + '\n...(truncated)' : trimmed;
      totalChars += preview.length;
      const relativeName = filePath.slice(prefix.length);
      changed.push({ name: relativeName, preview });
    } catch {
      // skip unreadable files
    }
  }

  return { changed, total: spaceFiles.length };
}

function buildIncrementalPrompt(
  spaceName: string,
  existingReadme: string,
  changedFiles: { name: string; preview: string }[],
  lang: 'zh' | 'en',
): string {
  const fileList = changedFiles
    .map(f => `### ${f.name}\n${f.preview}`)
    .join('\n\n');

  if (lang === 'zh') {
    return `你是一位知识库策展人。"${spaceName}" 空间的部分文件已更新。请基于现有的 README 和变更文件，生成更新后的完整 README.md。

要求：
1. 保持原有结构（标题、核心主题、重要文件、知识地图）
2. 整合变更文件的新内容，更新相关段落
3. 如果变更文件引入了新主题，添加到核心主题中
4. 如果变更文件替代了旧内容，更新重要文件列表
5. 保持简洁（200-400 字），使用 Markdown 格式
6. 不要虚构不存在的内容

现有 README：
${stripCompileMeta(existingReadme)}

变更的文件（共 ${changedFiles.length} 个）：

${fileList}`;
  }

  return `You are a knowledge base curator. Some files in the "${spaceName}" Space have been updated. Generate an updated full README.md based on the existing README and the changed files.

Requirements:
1. Keep the existing structure (title, key topics, notable files, knowledge map)
2. Integrate new content from changed files into relevant sections
3. If changed files introduce new topics, add them to Key Topics
4. If changed files replace old content, update the Notable Files list
5. Keep it concise (200-400 words), use Markdown formatting
6. Do NOT fabricate content

Existing README:
${stripCompileMeta(existingReadme)}

Changed files (${changedFiles.length} total):

${fileList}`;
}

/**
 * Generate a Space overview README using LLM.
 * Supports incremental mode: if README has a compile timestamp and
 * fewer than 50% of files changed, only send changed files to LLM.
 */
export async function compileSpaceOverview(
  space: string,
  signal?: AbortSignal,
): Promise<CompileResult | CompileError> {
  const cfg = effectiveAiConfig();
  if (!cfg.apiKey) {
    return { code: 'no_api_key', message: 'No AI API key configured. Go to Settings to add one.' };
  }

  const mindRoot = getMindRoot();
  resolveSafe(mindRoot, space);

  const spaceName = path.basename(space) || space;
  const readmePath = path.join(mindRoot, space, 'README.md');

  // Check for existing compile metadata → attempt incremental
  let existingReadme = '';
  let meta: CompileMeta | null = null;
  try {
    existingReadme = fs.readFileSync(readmePath, 'utf-8');
    meta = parseCompileMeta(existingReadme);
  } catch { /* no existing README, will do full compile */ }

  if (meta) {
    // Incremental path: check which files changed since last compile
    const { changed, total } = collectChangedFiles(mindRoot, space, meta.timestamp);

    if (changed.length === 0) {
      // Nothing changed — return immediately
      return {
        content: existingReadme,
        unchanged: true,
        stats: {
          fileCount: total,
          totalChars: 0,
          spaceName,
          scannedFiles: 0,
          mode: 'unchanged',
        },
      };
    }

    if (changed.length / total <= INCREMENTAL_THRESHOLD) {
      // Incremental mode: only send changed files + existing README
      const lang = detectLanguage(changed.map(f => f.preview));
      const prompt = buildIncrementalPrompt(spaceName, existingReadme, changed, lang);

      try {
        const { model, apiKey } = getModelConfig();
        const result = await complete(model, {
          messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        }, { apiKey, signal });

        const content = result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('');

        if (!content.trim()) {
          return { code: 'llm_error', message: 'AI returned empty response.' };
        }

        const now = new Date().toISOString();
        const finalContent = appendCompileMeta(content, { timestamp: now, fileCount: total });
        fs.writeFileSync(readmePath, finalContent, 'utf-8');
        invalidateCache();

        return {
          content: finalContent,
          stats: {
            fileCount: total,
            totalChars: changed.reduce((sum, f) => sum + f.preview.length, 0),
            spaceName,
            scannedFiles: changed.length,
            mode: 'incremental',
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { code: 'llm_error', message: msg.slice(0, 300) };
      }
    }
    // else: >50% changed → fall through to full compile
  }

  // Full compile path (original logic)
  const files = collectSpaceFiles(mindRoot, space);

  if (files.length === 0) {
    return { code: 'no_files', message: 'This Space has no files to analyze.' };
  }

  const lang = detectLanguage(files.map(f => f.preview));
  const prompt = buildPrompt(spaceName, files, lang);

  try {
    const { model, apiKey } = getModelConfig();
    const result = await complete(model, {
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
    }, {
      apiKey,
      signal,
    });

    const content = result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');

    if (!content.trim()) {
      return { code: 'llm_error', message: 'AI returned empty response.' };
    }

    const now = new Date().toISOString();
    const finalContent = appendCompileMeta(content, { timestamp: now, fileCount: files.length });
    fs.writeFileSync(readmePath, finalContent, 'utf-8');
    invalidateCache();

    return {
      content: finalContent,
      stats: {
        fileCount: files.length,
        totalChars: files.reduce((sum, f) => sum + f.preview.length, 0),
        spaceName,
        scannedFiles: files.length,
        mode: 'full',
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { code: 'llm_error', message: msg.slice(0, 300) };
  }
}

export function isCompileError(result: CompileResult | CompileError): result is CompileError {
  return 'code' in result;
}
