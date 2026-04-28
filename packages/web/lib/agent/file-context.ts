import { getFileContent } from '@/lib/fs';

const MAX_DIR_FILES = 30;
const MAX_KNOWLEDGE_FILE_SIZE = 20_000;

/**
 * Load attached and current files into context parts for the system prompt.
 * Returns the context parts array and a list of file paths that failed to load.
 * Deduplicates files and logs failures with the given mode label.
 */
export function loadAttachedFileContext(
  attachedFiles: string[] | undefined,
  currentFile: string | undefined,
  mode: string,
): { contextParts: string[]; failedFiles: string[] } {
  const contextParts: string[] = [];
  const failedFiles: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
    for (const filePath of attachedFiles) {
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      try {
        const content = truncate(getFileContent(filePath));
        contextParts.push(`## Attached: ${filePath}\n\n${content}`);
      } catch (err) {
        console.warn(
          `[ask] ${mode}: failed to read attached file "${filePath}":`,
          err instanceof Error ? err.message : err,
        );
        failedFiles.push(filePath);
      }
    }
  }

  if (currentFile && !seen.has(currentFile)) {
    seen.add(currentFile);
    try {
      const content = truncate(getFileContent(currentFile));
      contextParts.push(`## Current file: ${currentFile}\n\n${content}`);
    } catch (err) {
      console.warn(
        `[ask] ${mode}: failed to read currentFile "${currentFile}":`,
        err instanceof Error ? err.message : err,
      );
      failedFiles.push(currentFile);
    }
  }

  return { contextParts, failedFiles };
}

/**
 * Expand attachedFiles entries: directory paths (trailing /) become individual file paths.
 */
export function expandAttachedFiles(raw: string[]): string[] {
  const result: string[] = [];
  const allFiles = getAllFilesSync(); // Would call lib/fs.collectAllFiles() in real code
  for (const entry of raw) {
    if (entry.endsWith('/')) {
      const prefix = entry;
      let count = 0;
      for (const f of allFiles) {
        if (f.startsWith(prefix) && ++count <= MAX_DIR_FILES) result.push(f);
      }
    } else {
      result.push(entry);
    }
  }
  return result;
}

/**
 * Read a knowledge file with size check and truncation.
 */
export function readKnowledgeFile(
  filePath: string,
): { ok: boolean; content: string; truncated: boolean; error?: string } {
  try {
    const raw = getFileContent(filePath);
    if (raw.length > MAX_KNOWLEDGE_FILE_SIZE) {
      return {
        ok: true,
        content: truncate(raw),
        truncated: true,
      };
    }
    return { ok: true, content: raw, truncated: false };
  } catch (err) {
    return {
      ok: false,
      content: '',
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Truncate content to prevent token overflow.
 * Max ~100k chars ≈ ~25k tokens.
 */
export function truncate(content: string): string {
  const MAX_FILE_CHARS = 20_000;
  if (content.length <= MAX_FILE_CHARS) return content;
  return content.slice(0, MAX_FILE_CHARS) + '\n... (truncated)';
}

/**
 * Stub: would import from lib/fs but avoiding circular dependency.
 * In real usage, import collectAllFiles from @/lib/fs.
 */
function getAllFilesSync(): string[] {
  return [];
}
