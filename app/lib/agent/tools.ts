import { tool } from 'ai';
import { z } from 'zod';
import {
  searchFiles, getFileContent, getFileTree, getRecentlyModified,
  saveFileContent, createFile, appendToFile, insertAfterHeading, updateSection,
} from '@/lib/fs';
import { assertNotProtected } from '@/lib/core';

// Max chars per file to avoid token overflow (~100k chars ≈ ~25k tokens)
const MAX_FILE_CHARS = 20_000;

export function truncate(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  return content.slice(0, MAX_FILE_CHARS) + `\n\n[...truncated — file is ${content.length} chars, showing first ${MAX_FILE_CHARS}]`;
}

/** Checks write-protection using core's assertNotProtected */
export function assertWritable(filePath: string): void {
  assertNotProtected(filePath, 'modified by AI agent');
}

// ─── Knowledge base tools ─────────────────────────────────────────────────────

export const knowledgeBaseTools = {
  list_files: tool({
    description: 'List the full file tree of the knowledge base. Use this to browse what files exist.',
    inputSchema: z.object({}),
    execute: async () => {
      const tree = getFileTree();
      return JSON.stringify(tree, null, 2);
    },
  }),

  read_file: tool({
    description: 'Read the content of a file by its relative path. Always read a file before modifying it.',
    inputSchema: z.object({ path: z.string().describe('Relative file path, e.g. "Profile/👤 Identity.md"') }),
    execute: async ({ path }) => {
      try {
        return truncate(getFileContent(path));
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  search: tool({
    description: 'Full-text search across all files in the knowledge base. Returns matching files with context snippets.',
    inputSchema: z.object({ query: z.string().describe('Search query (case-insensitive)') }),
    execute: async ({ query }) => {
      const results = searchFiles(query);
      if (results.length === 0) return 'No results found.';
      return results.map(r => `- **${r.path}**: ${r.snippet}`).join('\n');
    },
  }),

  get_recent: tool({
    description: 'Get the most recently modified files in the knowledge base.',
    inputSchema: z.object({ limit: z.number().min(1).max(50).default(10).describe('Number of files to return') }),
    execute: async ({ limit }) => {
      const files = getRecentlyModified(limit);
      return files.map(f => `- ${f.path} (${new Date(f.mtime).toISOString()})`).join('\n');
    },
  }),

  write_file: tool({
    description: 'Overwrite the entire content of an existing file. Use read_file first to see current content. Prefer update_section or insert_after_heading for partial edits.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      content: z.string().describe('New full content'),
    }),
    execute: async ({ path, content }) => {
      try {
        assertWritable(path);
        saveFileContent(path, content);
        return `File written: ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  create_file: tool({
    description: 'Create a new file. Only .md and .csv files are allowed. Parent directories are created automatically.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path (must end in .md or .csv)'),
      content: z.string().default('').describe('Initial file content'),
    }),
    execute: async ({ path, content }) => {
      try {
        assertWritable(path);
        createFile(path, content);
        return `File created: ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  append_to_file: tool({
    description: 'Append text to the end of an existing file. A blank line separator is added automatically.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      content: z.string().describe('Content to append'),
    }),
    execute: async ({ path, content }) => {
      try {
        assertWritable(path);
        appendToFile(path, content);
        return `Content appended to: ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  insert_after_heading: tool({
    description: 'Insert content right after a Markdown heading. Useful for adding items under a specific section.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      heading: z.string().describe('Heading text to find (e.g. "## Tasks" or just "Tasks")'),
      content: z.string().describe('Content to insert after the heading'),
    }),
    execute: async ({ path, heading, content }) => {
      try {
        assertWritable(path);
        insertAfterHeading(path, heading, content);
        return `Content inserted after heading "${heading}" in ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  update_section: tool({
    description: 'Replace the content of a Markdown section identified by its heading. The section spans from the heading to the next heading of equal or higher level.',
    inputSchema: z.object({
      path: z.string().describe('Relative file path'),
      heading: z.string().describe('Heading text to find (e.g. "## Status")'),
      content: z.string().describe('New content for the section'),
    }),
    execute: async ({ path, heading, content }) => {
      try {
        assertWritable(path);
        updateSection(path, heading, content);
        return `Section "${heading}" updated in ${path}`;
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),
};
