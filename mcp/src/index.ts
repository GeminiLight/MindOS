#!/usr/bin/env node
/**
 * MindOS MCP Server
 *
 * Exposes the MindOS personal knowledge base as MCP tools:
 * read, write, create, delete, search files, list file tree,
 * get recently modified files, and append rows to CSV files.
 *
 * Transport: stdio (local personal knowledge base tool)
 *
 * Environment:
 *   MIND_ROOT  — absolute path to the knowledge base root directory
 *               (defaults to the directory two levels above this file)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs";
import path from "path";
import { z } from "zod";

// ─── Constants ───────────────────────────────────────────────────────────────

const MIND_ROOT = process.env.MIND_ROOT
  ?? path.resolve(new URL(import.meta.url).pathname, "../../..");

const IGNORED_DIRS = new Set([".git", "node_modules", "app", ".next", ".DS_Store", "mcp"]);
const ALLOWED_EXTENSIONS = new Set([".md", ".csv"]);
const CHARACTER_LIMIT = 25_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  extension?: string;
  children?: FileNode[];
}

interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  occurrences: number;
}

// ─── Security helper ─────────────────────────────────────────────────────────

function resolveSafe(filePath: string): string {
  const abs = path.join(MIND_ROOT, filePath);
  const resolved = path.resolve(abs);
  const root = path.resolve(MIND_ROOT);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Access denied: path "${filePath}" is outside MIND_ROOT`);
  }
  return resolved;
}

// ─── File system utilities ───────────────────────────────────────────────────

function getFileTree(dirPath: string = MIND_ROOT): FileNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(MIND_ROOT, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const children = getFileTree(fullPath);
      if (children.length > 0) {
        nodes.push({ name: entry.name, path: relativePath, type: "directory", children });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        nodes.push({ name: entry.name, path: relativePath, type: "file", extension: ext });
      }
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

function collectAllFiles(dirPath: string = MIND_ROOT): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...collectAllFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        files.push(path.relative(MIND_ROOT, fullPath));
      }
    }
  }
  return files;
}

function readFile(filePath: string): string {
  const resolved = resolveSafe(filePath);
  return fs.readFileSync(resolved, "utf-8");
}

function writeFile(filePath: string, content: string): void {
  const resolved = resolveSafe(filePath);
  const dir = path.dirname(resolved);
  const tmp = path.join(dir, `.tmp-${Date.now()}-${path.basename(resolved)}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, resolved);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

function createFile(filePath: string, initialContent = ""): void {
  const resolved = resolveSafe(filePath);
  if (fs.existsSync(resolved)) throw new Error(`File already exists: ${filePath}`);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, initialContent, "utf-8");
}

function deleteFile(filePath: string): void {
  const resolved = resolveSafe(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
  fs.unlinkSync(resolved);
}

function searchFiles(query: string, limit = 20): SearchResult[] {
  if (!query.trim()) return [];
  const allFiles = collectAllFiles();
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const escapedQuery = lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const filePath of allFiles) {
    let content: string;
    try { content = readFile(filePath); } catch { continue; }

    const lowerContent = content.toLowerCase();
    const index = lowerContent.indexOf(lowerQuery);
    if (index === -1) continue;

    const snippetStart = Math.max(0, index - 60);
    const snippetEnd = Math.min(content.length, index + query.length + 60);
    let snippet = content.slice(snippetStart, snippetEnd).replace(/\n/g, " ").trim();
    if (snippetStart > 0) snippet = "..." + snippet;
    if (snippetEnd < content.length) snippet += "...";

    const occurrences = (lowerContent.match(new RegExp(escapedQuery, "g")) ?? []).length;
    const score = occurrences / content.length;

    results.push({ path: filePath, snippet, score, occurrences });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function getRecentlyModified(limit = 10): Array<{ path: string; mtime: number; mtimeISO: string }> {
  const allFiles = collectAllFiles();
  const withMtime = allFiles.flatMap((filePath) => {
    try {
      const abs = path.join(MIND_ROOT, filePath);
      const stat = fs.statSync(abs);
      return [{ path: filePath, mtime: stat.mtimeMs, mtimeISO: stat.mtime.toISOString() }];
    } catch {
      return [];
    }
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.slice(0, limit);
}

function appendCsvRow(filePath: string, row: string[]): { newRowCount: number } {
  const resolved = resolveSafe(filePath);
  if (!filePath.endsWith(".csv")) throw new Error("Only .csv files support row append");

  const escaped = row.map((cell) => {
    if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  });
  const line = escaped.join(",") + "\n";

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, line, "utf-8");

  const content = fs.readFileSync(resolved, "utf-8");
  const newRowCount = content.trim().split("\n").length;
  return { newRowCount };
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function renderTree(nodes: FileNode[], indent = ""): string {
  const lines: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const prefix = indent + (isLast ? "└── " : "├── ");
    const childIndent = indent + (isLast ? "    " : "│   ");
    lines.push(prefix + node.name + (node.type === "directory" ? "/" : ""));
    if (node.children?.length) {
      lines.push(renderTree(node.children, childIndent));
    }
  }
  return lines.join("\n");
}

function truncate(text: string, limit = CHARACTER_LIMIT): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: text.slice(0, limit) + `\n\n[... truncated at ${limit} characters. Use offset/limit params for paginated access.]`,
    truncated: true,
  };
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "mindos-mcp-server",
  version: "1.0.0",
});

// ── mindos_list_files ─────────────────────────────────────────────────────────

server.registerTool(
  "mindos_list_files",
  {
    title: "List Knowledge Base Files",
    description: `Return the full file tree of the MindOS knowledge base as a directory tree.

Only .md and .csv files are included. Directories without relevant files are omitted.

Returns:
  - Markdown: ASCII tree representation (e.g. "├── Profile/\\n│   └── Identity.md")
  - JSON: Nested FileNode array with fields { name, path, type, extension?, children? }

Examples:
  - Use when: "Show me all files in the knowledge base"
  - Use when: "What directories exist under Workflows?"
  - Do NOT use when: You need file content (use mindos_read_file instead)`,
    inputSchema: z.object({
      response_format: z.enum(["markdown", "json"]).default("markdown")
        .describe("Output format: 'markdown' for ASCII tree, 'json' for structured data"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ response_format }) => {
    const tree = getFileTree();
    if (response_format === "json") {
      return { content: [{ type: "text", text: JSON.stringify(tree, null, 2) }] };
    }
    const text = `# MindOS Knowledge Base\n\nRoot: ${MIND_ROOT}\n\n${renderTree(tree)}`;
    return { content: [{ type: "text", text }] };
  }
);

// ── mindos_read_file ──────────────────────────────────────────────────────────

server.registerTool(
  "mindos_read_file",
  {
    title: "Read File Content",
    description: `Read the full content of a file in the MindOS knowledge base.

Args:
  - path (string): Relative path from the knowledge base root (e.g. "Profile/Identity.md")
  - offset (number): Character offset to start reading from (default: 0, for pagination)
  - limit (number): Max characters to return (default: 25000)

Returns: Raw file content as a string (Markdown or CSV text).

Examples:
  - Use when: "Read my Identity profile"  → path="Profile/👤 Identity.md"
  - Use when: "What's in TODO.md?"        → path="TODO.md"
  - For large files use offset+limit for paginated reads.

Error Handling:
  - Returns "File not found" if path doesn't exist
  - Returns "Access denied" if path escapes MIND_ROOT`,
    inputSchema: z.object({
      path: z.string().min(1).describe("Relative file path from knowledge base root"),
      offset: z.number().int().min(0).default(0).describe("Character offset for pagination"),
      limit: z.number().int().min(1).max(CHARACTER_LIMIT).default(CHARACTER_LIMIT)
        .describe(`Max characters to return (max: ${CHARACTER_LIMIT})`),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: filePath, offset, limit }) => {
    try {
      const content = readFile(filePath);
      const slice = content.slice(offset, offset + limit);
      const hasMore = offset + limit < content.length;
      const header = hasMore
        ? `[Showing characters ${offset}–${offset + slice.length} of ${content.length}. Use offset=${offset + limit} for next page.]\n\n`
        : offset > 0
          ? `[Showing characters ${offset}–${offset + slice.length} of ${content.length}]\n\n`
          : "";
      return { content: [{ type: "text", text: header + slice }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ── mindos_write_file ─────────────────────────────────────────────────────────

server.registerTool(
  "mindos_write_file",
  {
    title: "Write File Content",
    description: `Overwrite the entire content of an existing file in the MindOS knowledge base.
Uses atomic write (temp file + rename) to prevent data loss.

Args:
  - path (string): Relative file path from knowledge base root
  - content (string): New full content to write

Examples:
  - Use when: "Update TODO.md with new tasks"
  - Use when: "Save my edited Profile"
  - Do NOT use for creating new files (use mindos_create_file instead)
  - Do NOT use for CSV row append (use mindos_append_csv instead)

Error Handling:
  - Returns "Access denied" if path escapes MIND_ROOT`,
    inputSchema: z.object({
      path: z.string().min(1).describe("Relative file path from knowledge base root"),
      content: z.string().describe("Full new content to write to the file"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ path: filePath, content }) => {
    try {
      writeFile(filePath, content);
      return { content: [{ type: "text", text: `Successfully wrote ${content.length} characters to "${filePath}"` }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ── mindos_create_file ────────────────────────────────────────────────────────

server.registerTool(
  "mindos_create_file",
  {
    title: "Create New File",
    description: `Create a new file in the MindOS knowledge base. Parent directories are created automatically.
Only .md and .csv files are allowed.

Args:
  - path (string): Relative file path (e.g. "Research/new-paper.md")
  - content (string): Initial content (default: empty string)

Examples:
  - Use when: "Create a new meeting notes file"
  - Use when: "Start a new SOP document under Workflows/"

Error Handling:
  - Returns "File already exists" if path is taken — use mindos_write_file to overwrite`,
    inputSchema: z.object({
      path: z.string().min(1)
        .regex(/\.(md|csv)$/, "File must have .md or .csv extension")
        .describe("Relative path for the new file (must end in .md or .csv)"),
      content: z.string().default("").describe("Initial file content"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ path: filePath, content }) => {
    try {
      createFile(filePath, content);
      return { content: [{ type: "text", text: `Created "${filePath}" (${content.length} characters)` }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ── mindos_delete_file ────────────────────────────────────────────────────────

server.registerTool(
  "mindos_delete_file",
  {
    title: "Delete File",
    description: `Permanently delete a file from the MindOS knowledge base. This action is irreversible.

Args:
  - path (string): Relative file path to delete

Examples:
  - Use when: "Delete the draft file under Reference/Notes/"

Error Handling:
  - Returns "File not found" if path doesn't exist`,
    inputSchema: z.object({
      path: z.string().min(1).describe("Relative file path to delete"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ path: filePath }) => {
    try {
      deleteFile(filePath);
      return { content: [{ type: "text", text: `Deleted "${filePath}"` }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ── mindos_search_notes ───────────────────────────────────────────────────────

server.registerTool(
  "mindos_search_notes",
  {
    title: "Search Knowledge Base",
    description: `Full-text search across all .md and .csv files in the MindOS knowledge base.
Returns matching files with a snippet showing context around the first match, sorted by relevance (occurrence density).

Args:
  - query (string): Search string (case-insensitive, literal match)
  - limit (number): Max results to return (default: 20, max: 50)
  - response_format: 'markdown' for readable list, 'json' for structured data

Returns (JSON format):
  {
    "query": string,
    "total": number,
    "results": [
      { "path": string, "snippet": string, "occurrences": number, "score": number }
    ]
  }

Examples:
  - Use when: "Find all notes about MCP configuration"
  - Use when: "Search for dida365 mentions"
  - Use when: "Which files mention YouTube?"`,
    inputSchema: z.object({
      query: z.string().min(1).max(200).describe("Search string (case-insensitive)"),
      limit: z.number().int().min(1).max(50).default(20).describe("Max results to return"),
      response_format: z.enum(["markdown", "json"]).default("markdown")
        .describe("Output format"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ query, limit, response_format }) => {
    try {
      const results = searchFiles(query, limit);

      if (results.length === 0) {
        return { content: [{ type: "text", text: `No results found for "${query}"` }] };
      }

      if (response_format === "json") {
        const output = { query, total: results.length, results };
        const { text } = truncate(JSON.stringify(output, null, 2));
        return { content: [{ type: "text", text }] };
      }

      const lines = [`# Search Results: "${query}"`, ``, `Found ${results.length} file(s)`, ``];
      for (const r of results) {
        lines.push(`## ${r.path}`);
        lines.push(`- **Occurrences**: ${r.occurrences}`);
        lines.push(`- **Snippet**: ${r.snippet}`);
        lines.push(``);
      }
      const { text } = truncate(lines.join("\n"));
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ── mindos_get_recent ─────────────────────────────────────────────────────────

server.registerTool(
  "mindos_get_recent",
  {
    title: "Get Recently Modified Files",
    description: `Return the most recently modified files in the MindOS knowledge base, sorted by modification time descending.

Args:
  - limit (number): Number of files to return (default: 10, max: 50)
  - response_format: 'markdown' or 'json'

Returns (JSON):
  [{ "path": string, "mtime": number (ms), "mtimeISO": string }]

Examples:
  - Use when: "What have I been working on recently?"
  - Use when: "Show me the last modified files"`,
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(10).describe("Number of recent files to return"),
      response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ limit, response_format }) => {
    const files = getRecentlyModified(limit);

    if (response_format === "json") {
      return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
    }

    const lines = [`# Recently Modified Files`, ``];
    for (const f of files) {
      const date = new Date(f.mtime).toLocaleString();
      lines.push(`- **${f.path}** — ${date}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ── mindos_append_csv ─────────────────────────────────────────────────────────

server.registerTool(
  "mindos_append_csv",
  {
    title: "Append Row to CSV",
    description: `Append a new row to an existing (or new) CSV file in the MindOS knowledge base.
Cells containing commas, quotes, or newlines are automatically escaped per RFC 4180.

Args:
  - path (string): Relative path to a .csv file
  - row (string[]): Array of cell values for the new row

Returns: Confirmation with the total row count after appending.

Examples:
  - Use when: "Add a new product to Resources/Products.csv"
    → row=["Notion", "https://notion.so", "Productivity", "notes,wiki", "All-in-one workspace", "Pages, Databases", "Teams", "Free/Paid"]
  - Use when: "Log a new AI scholar to AI Scholars.csv"

Error Handling:
  - Returns error if path does not end in .csv`,
    inputSchema: z.object({
      path: z.string().min(1).regex(/\.csv$/, "Path must end in .csv").describe("Relative path to CSV file"),
      row: z.array(z.string()).min(1).describe("Array of cell values for the new row"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ path: filePath, row }) => {
    try {
      const { newRowCount } = appendCsvRow(filePath, row);
      return { content: [{ type: "text", text: `Appended row to "${filePath}". File now has ${newRowCount} rows (including header).` }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ─── Start server ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`MindOS MCP Server running (MIND_ROOT=${MIND_ROOT})\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
