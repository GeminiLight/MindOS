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
// ─── Security helper ─────────────────────────────────────────────────────────
function resolveSafe(filePath) {
    const abs = path.join(MIND_ROOT, filePath);
    const resolved = path.resolve(abs);
    const root = path.resolve(MIND_ROOT);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        throw new Error(`Access denied: path "${filePath}" is outside MIND_ROOT`);
    }
    return resolved;
}
// ─── File system utilities ───────────────────────────────────────────────────
function getFileTree(dirPath = MIND_ROOT) {
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const nodes = [];
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(MIND_ROOT, fullPath);
        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name))
                continue;
            const children = getFileTree(fullPath);
            if (children.length > 0) {
                nodes.push({ name: entry.name, path: relativePath, type: "directory", children });
            }
        }
        else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ALLOWED_EXTENSIONS.has(ext)) {
                nodes.push({ name: entry.name, path: relativePath, type: "file", extension: ext });
            }
        }
    }
    nodes.sort((a, b) => {
        if (a.type !== b.type)
            return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return nodes;
}
function collectAllFiles(dirPath = MIND_ROOT) {
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name))
                continue;
            files.push(...collectAllFiles(fullPath));
        }
        else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ALLOWED_EXTENSIONS.has(ext)) {
                files.push(path.relative(MIND_ROOT, fullPath));
            }
        }
    }
    return files;
}
function readFile(filePath) {
    const resolved = resolveSafe(filePath);
    return fs.readFileSync(resolved, "utf-8");
}
function writeFile(filePath, content) {
    const resolved = resolveSafe(filePath);
    const dir = path.dirname(resolved);
    const tmp = path.join(dir, `.tmp-${Date.now()}-${path.basename(resolved)}`);
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, content, "utf-8");
        fs.renameSync(tmp, resolved);
    }
    catch (err) {
        try {
            fs.unlinkSync(tmp);
        }
        catch { /* ignore */ }
        throw err;
    }
}
function createFile(filePath, initialContent = "") {
    const resolved = resolveSafe(filePath);
    if (fs.existsSync(resolved))
        throw new Error(`File already exists: ${filePath}`);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, initialContent, "utf-8");
}
function deleteFile(filePath) {
    const resolved = resolveSafe(filePath);
    if (!fs.existsSync(resolved))
        throw new Error(`File not found: ${filePath}`);
    fs.unlinkSync(resolved);
}
function searchFiles(query, limit = 20) {
    if (!query.trim())
        return [];
    const allFiles = collectAllFiles();
    const results = [];
    const lowerQuery = query.toLowerCase();
    const escapedQuery = lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const filePath of allFiles) {
        let content;
        try {
            content = readFile(filePath);
        }
        catch {
            continue;
        }
        const lowerContent = content.toLowerCase();
        const index = lowerContent.indexOf(lowerQuery);
        if (index === -1)
            continue;
        const snippetStart = Math.max(0, index - 60);
        const snippetEnd = Math.min(content.length, index + query.length + 60);
        let snippet = content.slice(snippetStart, snippetEnd).replace(/\n/g, " ").trim();
        if (snippetStart > 0)
            snippet = "..." + snippet;
        if (snippetEnd < content.length)
            snippet += "...";
        const occurrences = (lowerContent.match(new RegExp(escapedQuery, "g")) ?? []).length;
        const score = occurrences / content.length;
        results.push({ path: filePath, snippet, score, occurrences });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
}
function getRecentlyModified(limit = 10) {
    const allFiles = collectAllFiles();
    const withMtime = allFiles.flatMap((filePath) => {
        try {
            const abs = path.join(MIND_ROOT, filePath);
            const stat = fs.statSync(abs);
            return [{ path: filePath, mtime: stat.mtimeMs, mtimeISO: stat.mtime.toISOString() }];
        }
        catch {
            return [];
        }
    });
    withMtime.sort((a, b) => b.mtime - a.mtime);
    return withMtime.slice(0, limit);
}
// ─── Line-level operations ────────────────────────────────────────────────────
function readLines(filePath) {
    return readFile(filePath).split("\n");
}
function insertLines(filePath, afterIndex, lines) {
    const existing = readLines(filePath);
    const insertAt = afterIndex < 0 ? 0 : afterIndex + 1;
    existing.splice(insertAt, 0, ...lines);
    writeFile(filePath, existing.join("\n"));
}
function updateLines(filePath, startIndex, endIndex, newLines) {
    const existing = readLines(filePath);
    existing.splice(startIndex, endIndex - startIndex + 1, ...newLines);
    writeFile(filePath, existing.join("\n"));
}
function deleteLines(filePath, startIndex, endIndex) {
    const existing = readLines(filePath);
    existing.splice(startIndex, endIndex - startIndex + 1);
    writeFile(filePath, existing.join("\n"));
}
// ─── Semantic operations ──────────────────────────────────────────────────────
function appendToFile(filePath, content) {
    const existing = readFile(filePath);
    const separator = existing.length > 0 && !existing.endsWith("\n\n") ? "\n" : "";
    writeFile(filePath, existing + separator + content);
}
function insertAfterHeading(filePath, heading, content) {
    const lines = readLines(filePath);
    const idx = lines.findIndex((l) => {
        const trimmed = l.trim();
        return trimmed === heading || trimmed.replace(/^#+\s*/, "") === heading.replace(/^#+\s*/, "");
    });
    if (idx === -1)
        throw new Error(`Heading not found: "${heading}"`);
    let insertAt = idx + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === "")
        insertAt++;
    insertLines(filePath, insertAt - 1, ["", content]);
}
function updateSection(filePath, heading, newContent) {
    const lines = readLines(filePath);
    const idx = lines.findIndex((l) => {
        const trimmed = l.trim();
        return trimmed === heading || trimmed.replace(/^#+\s*/, "") === heading.replace(/^#+\s*/, "");
    });
    if (idx === -1)
        throw new Error(`Heading not found: "${heading}"`);
    const headingLevel = (lines[idx].match(/^#+/) ?? [""])[0].length;
    let sectionEnd = lines.length - 1;
    for (let i = idx + 1; i < lines.length; i++) {
        const m = lines[i].match(/^(#+)\s/);
        if (m && m[1].length <= headingLevel) {
            sectionEnd = i - 1;
            break;
        }
    }
    while (sectionEnd > idx && lines[sectionEnd].trim() === "")
        sectionEnd--;
    updateLines(filePath, idx + 1, sectionEnd, ["", newContent]);
}
function appendCsvRow(filePath, row) {
    const resolved = resolveSafe(filePath);
    if (!filePath.endsWith(".csv"))
        throw new Error("Only .csv files support row append");
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
// ─── Rename helper ────────────────────────────────────────────────────────
function renameFile(oldPath, newName) {
    if (newName.includes("/") || newName.includes("\\")) {
        throw new Error("Invalid filename: must not contain path separators");
    }
    const root = path.resolve(MIND_ROOT);
    const oldResolved = path.resolve(path.join(root, oldPath));
    if (!oldResolved.startsWith(root + path.sep) && oldResolved !== root) {
        throw new Error(`Access denied: path "${oldPath}" is outside MIND_ROOT`);
    }
    const dir = path.dirname(oldResolved);
    const newResolved = path.join(dir, newName);
    if (!newResolved.startsWith(root + path.sep) && newResolved !== root) {
        throw new Error("Access denied: new path is outside MIND_ROOT");
    }
    if (fs.existsSync(newResolved)) {
        throw new Error("A file with that name already exists");
    }
    fs.renameSync(oldResolved, newResolved);
    return path.relative(root, newResolved);
}
// ─── Format helpers ───────────────────────────────────────────────────────────
function renderTree(nodes, indent = "") {
    const lines = [];
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
function truncate(text, limit = CHARACTER_LIMIT) {
    if (text.length <= limit)
        return { text, truncated: false };
    return {
        text: text.slice(0, limit) + `\n\n[... truncated at ${limit} characters. Use offset/limit params for paginated access.]`,
        truncated: true,
    };
}
// ─── Audit logging ────────────────────────────────────────────────────────────
const AUDIT_FILE = "Agent-Audit.md";
const DIFF_FILE = "Agent-Diff.md";
function ensureAuditFile(filePath, title) {
    const resolved = path.join(MIND_ROOT, filePath);
    if (!fs.existsSync(resolved)) {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, `# ${title}\n\n`, "utf-8");
    }
}
function logOp(tool, params, result, message) {
    try {
        ensureAuditFile(AUDIT_FILE, "Agent Audit Log");
        const entry = JSON.stringify({ ts: new Date().toISOString(), tool, params, result, message });
        const block = `\n\`\`\`agent-op\n${entry}\n\`\`\`\n`;
        const resolved = path.join(MIND_ROOT, AUDIT_FILE);
        fs.appendFileSync(resolved, block, "utf-8");
    }
    catch { /* never throw from audit */ }
}
function logDiff(tool, filePath, before, after) {
    try {
        ensureAuditFile(DIFF_FILE, "Agent Diff Log");
        // Truncate very large before/after to avoid bloating the diff file
        const MAX = 8000;
        const entry = JSON.stringify({
            ts: new Date().toISOString(), path: filePath, tool,
            before: before.length > MAX ? before.slice(0, MAX) + "\n[truncated]" : before,
            after: after.length > MAX ? after.slice(0, MAX) + "\n[truncated]" : after,
        });
        const block = `\n\`\`\`agent-diff\n${entry}\n\`\`\`\n`;
        const resolved = path.join(MIND_ROOT, DIFF_FILE);
        fs.appendFileSync(resolved, block, "utf-8");
    }
    catch { /* never throw from audit */ }
}
// ─── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({
    name: "mindos-mcp-server",
    version: "1.0.0",
});
// ── mindos_list_files ─────────────────────────────────────────────────────────
server.registerTool("mindos_list_files", {
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
}, async ({ response_format }) => {
    const tree = getFileTree();
    if (response_format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(tree, null, 2) }] };
    }
    const text = `# MindOS Knowledge Base\n\nRoot: ${MIND_ROOT}\n\n${renderTree(tree)}`;
    return { content: [{ type: "text", text }] };
});
// ── mindos_read_file ──────────────────────────────────────────────────────────
server.registerTool("mindos_read_file", {
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
}, async ({ path: filePath, offset, limit }) => {
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
    }
    catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_write_file ─────────────────────────────────────────────────────────
server.registerTool("mindos_write_file", {
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
}, async ({ path: filePath, content }) => {
    try {
        let before = "";
        try {
            before = readFile(filePath);
        }
        catch { /* new file */ }
        writeFile(filePath, content);
        logOp("mindos_write_file", { path: filePath, content: content.slice(0, 200) + (content.length > 200 ? "…" : "") }, "ok", `Wrote ${content.length} chars`);
        if (before !== content)
            logDiff("mindos_write_file", filePath, before, content);
        return { content: [{ type: "text", text: `Successfully wrote ${content.length} characters to "${filePath}"` }] };
    }
    catch (err) {
        logOp("mindos_write_file", { path: filePath }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_create_file ────────────────────────────────────────────────────────
server.registerTool("mindos_create_file", {
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
}, async ({ path: filePath, content }) => {
    try {
        createFile(filePath, content);
        logOp("mindos_create_file", { path: filePath }, "ok", `Created ${content.length} chars`);
        return { content: [{ type: "text", text: `Created "${filePath}" (${content.length} characters)` }] };
    }
    catch (err) {
        logOp("mindos_create_file", { path: filePath }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_delete_file ────────────────────────────────────────────────────────
server.registerTool("mindos_delete_file", {
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
}, async ({ path: filePath }) => {
    try {
        let before = "";
        try {
            before = readFile(filePath);
        }
        catch { /* ignore */ }
        deleteFile(filePath);
        logOp("mindos_delete_file", { path: filePath }, "ok", `Deleted (was ${before.length} chars)`);
        return { content: [{ type: "text", text: `Deleted "${filePath}"` }] };
    }
    catch (err) {
        logOp("mindos_delete_file", { path: filePath }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_search_notes ───────────────────────────────────────────────────────
server.registerTool("mindos_search_notes", {
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
}, async ({ query, limit, response_format }) => {
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
    }
    catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_get_recent ─────────────────────────────────────────────────────────
server.registerTool("mindos_get_recent", {
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
}, async ({ limit, response_format }) => {
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
});
// ── mindos_append_csv ─────────────────────────────────────────────────────────
server.registerTool("mindos_append_csv", {
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
}, async ({ path: filePath, row }) => {
    try {
        const { newRowCount } = appendCsvRow(filePath, row);
        return { content: [{ type: "text", text: `Appended row to "${filePath}". File now has ${newRowCount} rows (including header).` }] };
    }
    catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_read_lines ─────────────────────────────────────────────────────────
server.registerTool("mindos_read_lines", {
    title: "Read File as Lines",
    description: `Read the content of a file as a numbered array of lines.
Useful when you need to reference specific line numbers for subsequent insert/update/delete operations.

Args:
  - path (string): Relative file path from knowledge base root

Returns: JSON array of line strings (0-indexed).

Examples:
  - Use when: You need to know line numbers before editing
  - Use when: "Show me the lines in TODO.md"`,
    inputSchema: z.object({
        path: z.string().min(1).describe("Relative file path from knowledge base root"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path: filePath }) => {
    try {
        const lines = readLines(filePath);
        const numbered = lines.map((l, i) => `${i}: ${l}`).join("\n");
        return { content: [{ type: "text", text: `${lines.length} lines total:\n\n${numbered}` }] };
    }
    catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_insert_lines ───────────────────────────────────────────────────────
server.registerTool("mindos_insert_lines", {
    title: "Insert Lines into File",
    description: `Insert one or more lines into a file at a specific position (0-based index).

Args:
  - path (string): Relative file path
  - after_index (number): Insert after this 0-based line index. Use -1 to prepend at the start.
  - lines (string[]): Lines to insert

Examples:
  - Use when: "Insert a new task after line 5 in TODO.md"
  - Use when: "Add two lines after the header"
  - Use -1 to insert at the very beginning of the file`,
    inputSchema: z.object({
        path: z.string().min(1).describe("Relative file path"),
        after_index: z.number().int().describe("Insert after this 0-based line index (-1 to prepend)"),
        lines: z.array(z.string()).min(1).describe("Lines to insert"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ path: filePath, after_index, lines }) => {
    try {
        insertLines(filePath, after_index, lines);
        logOp("mindos_insert_lines", { path: filePath, after_index, lines_count: lines.length }, "ok");
        return { content: [{ type: "text", text: `Inserted ${lines.length} line(s) after index ${after_index} in "${filePath}"` }] };
    }
    catch (err) {
        logOp("mindos_insert_lines", { path: filePath, after_index }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_update_lines ───────────────────────────────────────────────────────
server.registerTool("mindos_update_lines", {
    title: "Replace Lines in File",
    description: `Replace a range of lines in a file with new content (both start and end are inclusive, 0-based).

Args:
  - path (string): Relative file path
  - start (number): First line to replace (0-based, inclusive)
  - end (number): Last line to replace (0-based, inclusive)
  - lines (string[]): Replacement lines (can be more or fewer than the replaced range)

Examples:
  - Use when: "Update line 3 of TODO.md"           → start=3, end=3
  - Use when: "Replace lines 5–8 with new content" → start=5, end=8
  - Use when: "Update a CSV row at line 12"         → start=12, end=12`,
    inputSchema: z.object({
        path: z.string().min(1).describe("Relative file path"),
        start: z.number().int().min(0).describe("First line to replace (0-based, inclusive)"),
        end: z.number().int().min(0).describe("Last line to replace (0-based, inclusive)"),
        lines: z.array(z.string()).min(1).describe("Replacement lines"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path: filePath, start, end, lines }) => {
    try {
        updateLines(filePath, start, end, lines);
        logOp("mindos_update_lines", { path: filePath, start, end, lines_count: lines.length }, "ok");
        return { content: [{ type: "text", text: `Replaced lines ${start}–${end} in "${filePath}" with ${lines.length} new line(s)` }] };
    }
    catch (err) {
        logOp("mindos_update_lines", { path: filePath, start, end }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_delete_lines ───────────────────────────────────────────────────────
server.registerTool("mindos_delete_lines", {
    title: "Delete Lines from File",
    description: `Delete a range of lines from a file (both start and end are inclusive, 0-based).

Args:
  - path (string): Relative file path
  - start (number): First line to delete (0-based, inclusive)
  - end (number): Last line to delete (0-based, inclusive)

Examples:
  - Use when: "Delete line 7 from TODO.md"       → start=7, end=7
  - Use when: "Remove lines 10–14 from the file" → start=10, end=14`,
    inputSchema: z.object({
        path: z.string().min(1).describe("Relative file path"),
        start: z.number().int().min(0).describe("First line to delete (0-based, inclusive)"),
        end: z.number().int().min(0).describe("Last line to delete (0-based, inclusive)"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ path: filePath, start, end }) => {
    try {
        deleteLines(filePath, start, end);
        logOp("mindos_delete_lines", { path: filePath, start, end }, "ok");
        return { content: [{ type: "text", text: `Deleted lines ${start}–${end} from "${filePath}"` }] };
    }
    catch (err) {
        logOp("mindos_delete_lines", { path: filePath, start, end }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_append_to_file ─────────────────────────────────────────────────────
server.registerTool("mindos_append_to_file", {
    title: "Append Content to File",
    description: `Append text to the end of an existing file. Automatically inserts a blank line separator if needed.

Args:
  - path (string): Relative file path
  - content (string): Text to append

Examples:
  - Use when: "Add a new entry to the bottom of my notes"
  - Use when: "Append a new section to TODO.md"
  - Use when: "Add a log entry to a Markdown file"`,
    inputSchema: z.object({
        path: z.string().min(1).describe("Relative file path"),
        content: z.string().min(1).describe("Content to append to the file"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ path: filePath, content }) => {
    try {
        appendToFile(filePath, content);
        logOp("mindos_append_to_file", { path: filePath, content: content.slice(0, 120) + (content.length > 120 ? "…" : "") }, "ok");
        return { content: [{ type: "text", text: `Appended ${content.length} character(s) to "${filePath}"` }] };
    }
    catch (err) {
        logOp("mindos_append_to_file", { path: filePath }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_insert_after_heading ───────────────────────────────────────────────
server.registerTool("mindos_insert_after_heading", {
    title: "Insert Content After Heading",
    description: `Insert content immediately after the first occurrence of a Markdown heading.
Matches by heading text (ignores leading #s). Skips blank lines after the heading before inserting.

Args:
  - path (string): Relative file path (must be a .md file)
  - heading (string): Heading text to find (e.g. "## Tasks" or just "Tasks")
  - content (string): Content to insert after the heading

Examples:
  - Use when: "Add a new item under the ## Tasks section"
  - Use when: "Insert a note right after the Introduction heading"

Error: Throws if heading not found.`,
    inputSchema: z.object({
        path: z.string().min(1).describe("Relative file path"),
        heading: z.string().min(1).describe("Heading text (with or without leading #s)"),
        content: z.string().min(1).describe("Content to insert after the heading"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ path: filePath, heading, content }) => {
    try {
        insertAfterHeading(filePath, heading, content);
        logOp("mindos_insert_after_heading", { path: filePath, heading }, "ok");
        return { content: [{ type: "text", text: `Inserted content after heading "${heading}" in "${filePath}"` }] };
    }
    catch (err) {
        logOp("mindos_insert_after_heading", { path: filePath, heading }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_update_section ─────────────────────────────────────────────────────
server.registerTool("mindos_update_section", {
    title: "Replace Markdown Section Content",
    description: `Replace the entire content of a Markdown section identified by its heading.
The section spans from the line after the heading to the line before the next heading of equal or higher level (or end of file).

Args:
  - path (string): Relative file path (must be a .md file)
  - heading (string): Heading text to find (e.g. "## Status" or just "Status")
  - content (string): New content for the section (replaces everything between heading and next sibling heading)

Examples:
  - Use when: "Update the ## Status section of my project file"
  - Use when: "Replace the Goals section with new objectives"

Error: Throws if heading not found.`,
    inputSchema: z.object({
        path: z.string().min(1).describe("Relative file path"),
        heading: z.string().min(1).describe("Heading text (with or without leading #s)"),
        content: z.string().describe("New content for the section"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path: filePath, heading, content }) => {
    try {
        let before = "";
        try {
            before = readFile(filePath);
        }
        catch { /* ignore */ }
        updateSection(filePath, heading, content);
        const after = readFile(filePath);
        logOp("mindos_update_section", { path: filePath, heading }, "ok");
        if (before !== after)
            logDiff("mindos_update_section", filePath, before, after);
        return { content: [{ type: "text", text: `Updated section "${heading}" in "${filePath}"` }] };
    }
    catch (err) {
        logOp("mindos_update_section", { path: filePath, heading }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ── mindos_rename_file ─────────────────────────────────────────────────────
server.registerTool("mindos_rename_file", {
    title: "Rename File",
    description: `Rename a file within its current directory. The file stays in the same folder — only the filename changes.

Args:
  - path (string): Current relative file path (e.g. "Profile/Identity.md")
  - new_name (string): New filename only, no path separators (e.g. "My Identity.md")

Returns: The new relative path after renaming.

Examples:
  - Use when: "Rename TODO.md to Tasks.md"
  - Use when: "Change the filename of Profile/Identity.md to My-Profile.md"

Error Handling:
  - Returns error if new_name contains path separators
  - Returns error if a file with that name already exists in the same directory`,
    inputSchema: z.object({
        path: z.string().min(1).describe("Current relative file path"),
        new_name: z.string().min(1).describe("New filename (no path separators)"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ path: filePath, new_name }) => {
    try {
        const newPath = renameFile(filePath, new_name);
        logOp("mindos_rename_file", { path: filePath, new_name }, "ok", `Renamed to ${newPath}`);
        return { content: [{ type: "text", text: `Renamed "${filePath}" → "${newPath}"` }] };
    }
    catch (err) {
        logOp("mindos_rename_file", { path: filePath, new_name }, "error", String(err));
        return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
});
// ─── Start server ─────────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`MindOS MCP Server running (MIND_ROOT=${MIND_ROOT})\n`);
}
main().catch((err) => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map