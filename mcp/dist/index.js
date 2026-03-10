#!/usr/bin/env node
/**
 * MindOS MCP Server
 *
 * Exposes the MindOS personal knowledge base as MCP tools:
 * read, write, create, delete, search, rename, move files,
 * list file tree, get recently modified files, append CSV rows,
 * bootstrap agent context, find backlinks, and git history.
 *
 * Protected files: root INSTRUCTION.md cannot be modified via MCP (§7).
 *
 * Transport: stdio (local personal knowledge base tool)
 *
 * Environment:
 *   MIND_ROOT  — absolute path to the knowledge base root directory
 *               (defaults to the directory two levels above this file)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";
// ─── Constants ───────────────────────────────────────────────────────────────
const MIND_ROOT = process.env.MIND_ROOT
    ?? path.resolve(new URL(import.meta.url).pathname, "../../..");
const IGNORED_DIRS = new Set([".git", "node_modules", "app", ".next", ".DS_Store", "mcp"]);
const ALLOWED_EXTENSIONS = new Set([".md", ".csv"]);
const CHARACTER_LIMIT = 25_000;
const MCP_TRANSPORT = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
const MCP_HOST = process.env.MCP_HOST ?? "127.0.0.1";
const MCP_PORT = Number(process.env.MCP_PORT ?? 8787);
const MCP_ENDPOINT = process.env.MCP_ENDPOINT ?? "/mcp";
const MCP_HTTP_STATEFUL = (process.env.MCP_HTTP_STATEFUL ?? "false").toLowerCase() === "true";
const AUTH_TOKEN = process.env.AUTH_TOKEN;
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
// ─── Protected files ────────────────────────────────────────────────────────
const ROOT_PROTECTED_FILES = new Set(["INSTRUCTION.md"]);
function isRootProtected(filePath) {
    const normalized = path.normalize(filePath);
    return ROOT_PROTECTED_FILES.has(normalized);
}
function assertNotProtected(filePath, operation) {
    if (isRootProtected(filePath)) {
        throw new Error(`Protected file: root "${filePath}" cannot be ${operation} via MCP. ` +
            `This is a system kernel file (§7 of INSTRUCTION.md). Edit it manually or use a dedicated confirmation workflow.`);
    }
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
function searchFiles(query, opts = {}) {
    if (!query.trim())
        return [];
    const { limit = 20, scope, file_type = "all", modified_after } = opts;
    let allFiles = collectAllFiles();
    // Filter by scope (directory prefix)
    if (scope) {
        const normalizedScope = scope.endsWith("/") ? scope : scope + "/";
        allFiles = allFiles.filter(f => f.startsWith(normalizedScope) || f === scope);
    }
    // Filter by file type
    if (file_type !== "all") {
        const ext = `.${file_type}`;
        allFiles = allFiles.filter(f => f.endsWith(ext));
    }
    // Filter by modification time
    let mtimeThreshold = 0;
    if (modified_after) {
        mtimeThreshold = new Date(modified_after).getTime();
        if (isNaN(mtimeThreshold))
            mtimeThreshold = 0;
    }
    const results = [];
    const lowerQuery = query.toLowerCase();
    const escapedQuery = lowerQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const filePath of allFiles) {
        // Check mtime filter before reading content (cheaper)
        if (mtimeThreshold > 0) {
            try {
                const abs = path.join(MIND_ROOT, filePath);
                const stat = fs.statSync(abs);
                if (stat.mtimeMs < mtimeThreshold)
                    continue;
            }
            catch {
                continue;
            }
        }
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
// ─── Backlinks ─────────────────────────────────────────────────────────────
function findBacklinks(targetPath) {
    const allFiles = collectAllFiles().filter(f => f.endsWith(".md") && f !== targetPath);
    const results = [];
    const bname = path.basename(targetPath, ".md");
    const escapedTarget = targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedBname = bname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        new RegExp(`\\[\\[${escapedBname}(?:[|#][^\\]]*)?\\]\\]`, "i"),
        new RegExp(`\\[\\[${escapedTarget}(?:[|#][^\\]]*)?\\]\\]`, "i"),
        new RegExp(`\\[[^\\]]+\\]\\(${escapedTarget}(?:#[^)]*)?\\)`, "i"),
        new RegExp(`\\[[^\\]]+\\]\\([^)]*${escapedBname}\\.md(?:#[^)]*)?\\)`, "i"),
        new RegExp("`" + escapedTarget.replace(/\//g, "\\/") + "`"),
    ];
    for (const filePath of allFiles) {
        let content;
        try {
            content = readFile(filePath);
        }
        catch {
            continue;
        }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (patterns.some(p => p.test(lines[i]))) {
                const start = Math.max(0, i - 1);
                const end = Math.min(lines.length - 1, i + 1);
                const ctx = lines.slice(start, end + 1).join("\n").trim();
                results.push({ source: filePath, line: i + 1, context: ctx });
                break; // one match per file is enough for overview
            }
        }
    }
    return results;
}
// ─── Git helpers ────────────────────────────────────────────────────────────
function isGitRepo() {
    try {
        execSync("git rev-parse --is-inside-work-tree", { cwd: MIND_ROOT, stdio: "pipe" });
        return true;
    }
    catch {
        return false;
    }
}
function gitLog(filePath, limit) {
    const resolved = resolveSafe(filePath);
    const output = execSync(`git log --follow --format="%H%x00%aI%x00%s%x00%an" -n ${limit} -- "${resolved}"`, { cwd: MIND_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (!output)
        return [];
    return output.split("\n").map(line => {
        const [hash, date, message, author] = line.split("\0");
        return { hash, date, message, author };
    });
}
function gitShowFile(filePath, commitHash) {
    const resolved = resolveSafe(filePath);
    const relFromGitRoot = execSync(`git ls-files --full-name "${resolved}"`, { cwd: MIND_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (!relFromGitRoot) {
        // Fallback: try relative path directly
        return execSync(`git show ${commitHash}:"${filePath}"`, { cwd: MIND_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    }
    return execSync(`git show ${commitHash}:"${relFromGitRoot}"`, { cwd: MIND_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}
// ─── Move file helper ───────────────────────────────────────────────────────
function moveFile(fromPath, toPath) {
    const fromResolved = resolveSafe(fromPath);
    const toResolved = resolveSafe(toPath);
    if (!fs.existsSync(fromResolved))
        throw new Error(`Source not found: ${fromPath}`);
    if (fs.existsSync(toResolved))
        throw new Error(`Destination already exists: ${toPath}`);
    fs.mkdirSync(path.dirname(toResolved), { recursive: true });
    fs.renameSync(fromResolved, toResolved);
    // Find files that reference the old path
    const backlinks = findBacklinks(fromPath);
    return { newPath: toPath, affectedFiles: backlinks.map(b => b.source) };
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
function createMindosServer() {
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
            assertNotProtected(filePath, "modified");
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
            assertNotProtected(filePath, "deleted");
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
  - scope (string, optional): Limit search to a subdirectory (e.g. "Workflows/", "Profile/")
  - file_type (string, optional): Filter by file type — "md", "csv", or "all" (default: "all")
  - modified_after (string, optional): Only include files modified after this date (ISO format, e.g. "2025-01-01")
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
  - Use when: "Search for dida365 in Workflows/" → scope="Workflows/"
  - Use when: "Which CSV files mention YouTube?" → file_type="csv"
  - Use when: "Find recently modified files mentioning TODO" → modified_after="2025-03-01"`,
        inputSchema: z.object({
            query: z.string().min(1).max(200).describe("Search string (case-insensitive)"),
            limit: z.number().int().min(1).max(50).default(20).describe("Max results to return"),
            scope: z.string().optional().describe("Limit search to a subdirectory (e.g. \"Workflows/\")"),
            file_type: z.enum(["md", "csv", "all"]).default("all").describe("Filter by file type"),
            modified_after: z.string().optional().describe("Only files modified after this ISO date (e.g. \"2025-01-01\")"),
            response_format: z.enum(["markdown", "json"]).default("markdown")
                .describe("Output format"),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ query, limit, scope, file_type, modified_after, response_format }) => {
        try {
            const results = searchFiles(query, { limit, scope, file_type, modified_after });
            if (results.length === 0) {
                return { content: [{ type: "text", text: `No results found for "${query}"${scope ? ` in ${scope}` : ""}` }] };
            }
            if (response_format === "json") {
                const output = { query, total: results.length, scope: scope ?? null, file_type, modified_after: modified_after ?? null, results };
                const { text } = truncate(JSON.stringify(output, null, 2));
                return { content: [{ type: "text", text }] };
            }
            const filters = [scope ? `scope: ${scope}` : null, file_type !== "all" ? `type: .${file_type}` : null, modified_after ? `after: ${modified_after}` : null].filter(Boolean);
            const filterStr = filters.length > 0 ? ` (${filters.join(", ")})` : "";
            const lines = [`# Search Results: "${query}"${filterStr}`, ``, `Found ${results.length} file(s)`, ``];
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
            assertNotProtected(filePath, "modified");
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
            assertNotProtected(filePath, "modified");
            updateLines(filePath, start, end, lines);
            logOp("mindos_update_lines", { path: filePath, start, end, lines_count: lines.length }, "ok");
            return { content: [{ type: "text", text: `Replaced lines ${start}–${end} in "${filePath}" with ${lines.length} new line(s)` }] };
        }
        catch (err) {
            logOp("mindos_update_lines", { path: filePath, start, end }, "error", String(err));
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
            assertNotProtected(filePath, "modified");
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
            assertNotProtected(filePath, "modified");
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
            assertNotProtected(filePath, "modified");
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
            assertNotProtected(filePath, "renamed");
            const newPath = renameFile(filePath, new_name);
            logOp("mindos_rename_file", { path: filePath, new_name }, "ok", `Renamed to ${newPath}`);
            return { content: [{ type: "text", text: `Renamed "${filePath}" → "${newPath}"` }] };
        }
        catch (err) {
            logOp("mindos_rename_file", { path: filePath, new_name }, "error", String(err));
            return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
        }
    });
    // ── mindos_bootstrap ──────────────────────────────────────────────────────────
    server.registerTool("mindos_bootstrap", {
        title: "Bootstrap Agent Context",
        description: `Load the MindOS startup context in one call (implements §1 Startup Protocol of INSTRUCTION.md).

Returns the system rules (INSTRUCTION.md), root index (README.md), root CONFIG pair (CONFIG.json + CONFIG.md), and optionally the target directory's README.md, local INSTRUCTION.md, and local CONFIG pair.

This is the recommended first tool call for any Agent entering the knowledge base.

Args:
  - target_dir (string, optional): Target directory to load context for (e.g. "Workflows/Research")

Returns:
  {
    instruction: root INSTRUCTION.md content,
    index: root README.md content,
    config_json: root CONFIG.json content,
    config_md: root CONFIG.md content,
    target_readme?: target directory README.md (if target_dir specified and file exists),
    target_instruction?: target directory INSTRUCTION.md (if exists),
    target_config_json?: target directory CONFIG.json (if exists),
    target_config_md?: target directory CONFIG.md (if exists)
  }`,
        inputSchema: z.object({
            target_dir: z.string().optional().describe("Optional target directory to load context for"),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ target_dir }) => {
        try {
            let instruction = "";
            try {
                instruction = readFile("INSTRUCTION.md");
            }
            catch {
                instruction = "[INSTRUCTION.md not found]";
            }
            let index = "";
            try {
                index = readFile("README.md");
            }
            catch {
                index = "[README.md not found]";
            }
            let configJson = "";
            try {
                configJson = readFile("CONFIG.json");
            }
            catch {
                configJson = "[CONFIG.json not found]";
            }
            let configMd = "";
            try {
                configMd = readFile("CONFIG.md");
            }
            catch {
                configMd = "[CONFIG.md not found]";
            }
            const result = {
                instruction,
                index,
                config_json: configJson,
                config_md: configMd,
            };
            if (target_dir) {
                const dir = target_dir.endsWith("/") ? target_dir.slice(0, -1) : target_dir;
                try {
                    result.target_readme = readFile(`${dir}/README.md`);
                }
                catch { /* not found */ }
                try {
                    result.target_instruction = readFile(`${dir}/INSTRUCTION.md`);
                }
                catch { /* not found */ }
                try {
                    result.target_config_json = readFile(`${dir}/CONFIG.json`);
                }
                catch { /* not found */ }
                try {
                    result.target_config_md = readFile(`${dir}/CONFIG.md`);
                }
                catch { /* not found */ }
            }
            const sections = Object.entries(result)
                .map(([key, val]) => `--- ${key} ---\n\n${val}`)
                .join("\n\n");
            return { content: [{ type: "text", text: sections }] };
        }
        catch (err) {
            return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
        }
    });
    // ── mindos_get_backlinks ──────────────────────────────────────────────────────
    server.registerTool("mindos_get_backlinks", {
        title: "Find Backlinks to File",
        description: `Find all files that reference a given file path via wikilinks, markdown links, or backtick references.

Essential for §4.2 sync rules — before renaming or deleting a file, check what references it.

Args:
  - path (string): Relative file path to find backlinks for (e.g. "Profile/👤 Identity.md")

Returns: Array of { source, line, context } showing each referencing file with surrounding context.

Examples:
  - Use when: "What files link to Profile/👤 Identity.md?"
  - Use when: About to rename/delete a file and need to know what to update
  - Use when: Understanding the dependency graph of a specific file`,
        inputSchema: z.object({
            path: z.string().min(1).describe("Relative file path to find backlinks for"),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ path: filePath }) => {
        try {
            const backlinks = findBacklinks(filePath);
            if (backlinks.length === 0) {
                return { content: [{ type: "text", text: `No backlinks found for "${filePath}"` }] };
            }
            const lines = [`# Backlinks to "${filePath}"`, ``, `Found ${backlinks.length} file(s) referencing this file:`, ``];
            for (const bl of backlinks) {
                lines.push(`## ${bl.source} (line ${bl.line})`);
                lines.push("```");
                lines.push(bl.context);
                lines.push("```");
                lines.push("");
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        catch (err) {
            return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
        }
    });
    // ── mindos_get_history ────────────────────────────────────────────────────────
    server.registerTool("mindos_get_history", {
        title: "Get File Git History",
        description: `Get the git commit history for a specific file. Requires the knowledge base to be a git repository.

Args:
  - path (string): Relative file path
  - limit (number): Max commits to return (default: 10, max: 50)

Returns: Array of { hash, date, message, author } sorted newest first.

Examples:
  - Use when: "Show the edit history of TODO.md"
  - Use when: "Who last modified Profile/Identity.md?"
  - Use when: "What changes were made to this file recently?"`,
        inputSchema: z.object({
            path: z.string().min(1).describe("Relative file path"),
            limit: z.number().int().min(1).max(50).default(10).describe("Max commits to return"),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ path: filePath, limit }) => {
        try {
            if (!isGitRepo()) {
                return { isError: true, content: [{ type: "text", text: "Knowledge base is not a git repository" }] };
            }
            const history = gitLog(filePath, limit);
            if (history.length === 0) {
                return { content: [{ type: "text", text: `No git history found for "${filePath}"` }] };
            }
            const lines = [`# Git History: ${filePath}`, ``, `${history.length} commit(s):`, ``];
            for (const h of history) {
                lines.push(`- **${h.date}** \`${h.hash.slice(0, 8)}\` — ${h.message} (${h.author})`);
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        catch (err) {
            return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
        }
    });
    // ── mindos_get_file_at_version ────────────────────────────────────────────────
    server.registerTool("mindos_get_file_at_version", {
        title: "Read File at Git Version",
        description: `Read the content of a file at a specific git commit. Use mindos_get_history first to find commit hashes.

Args:
  - path (string): Relative file path
  - commit (string): Git commit hash (full or abbreviated)

Returns: File content at that version.

Examples:
  - Use when: "Show me TODO.md as of commit abc1234"
  - Use when: "What did this file look like before the last change?"`,
        inputSchema: z.object({
            path: z.string().min(1).describe("Relative file path"),
            commit: z.string().min(4).describe("Git commit hash"),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ path: filePath, commit }) => {
        try {
            if (!isGitRepo()) {
                return { isError: true, content: [{ type: "text", text: "Knowledge base is not a git repository" }] };
            }
            const content = gitShowFile(filePath, commit);
            const { text, truncated } = truncate(content);
            const header = `# ${filePath} @ ${commit.slice(0, 8)}\n\n`;
            return { content: [{ type: "text", text: header + text + (truncated ? "\n\n[truncated]" : "") }] };
        }
        catch (err) {
            return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
        }
    });
    // ── mindos_move_file ──────────────────────────────────────────────────────────
    server.registerTool("mindos_move_file", {
        title: "Move File",
        description: `Move a file to a new path within the knowledge base. Parent directories are created automatically.
Also returns a list of files that reference the old path (backlinks) so you can update them.

Args:
  - from_path (string): Current relative file path
  - to_path (string): Destination relative file path

Returns: New path + list of files that need their references updated.

Examples:
  - Use when: "Move this file from Workflows/ to Projects/"
  - Use when: Reorganizing directory structure (§8.1)`,
        inputSchema: z.object({
            from_path: z.string().min(1).describe("Current relative file path"),
            to_path: z.string().min(1).describe("Destination relative file path"),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ from_path, to_path }) => {
        try {
            assertNotProtected(from_path, "moved");
            const { newPath, affectedFiles } = moveFile(from_path, to_path);
            logOp("mindos_move_file", { from: from_path, to: to_path }, "ok");
            const lines = [`Moved "${from_path}" → "${newPath}"`];
            if (affectedFiles.length > 0) {
                lines.push("", `⚠️ ${affectedFiles.length} file(s) reference the old path and may need updating:`);
                for (const f of affectedFiles)
                    lines.push(`  - ${f}`);
            }
            else {
                lines.push("", "No files reference the old path.");
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        catch (err) {
            logOp("mindos_move_file", { from: from_path, to: to_path }, "error", String(err));
            return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
        }
    });
    return server;
}
// ─── Start server ─────────────────────────────────────────────────────────────
function getAuthToken(authorizationHeader) {
    if (!authorizationHeader)
        return undefined;
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim();
}
function isAuthorized(authorizationHeader) {
    if (!AUTH_TOKEN)
        return true;
    return getAuthToken(authorizationHeader) === AUTH_TOKEN;
}
function sendJsonRpcError(res, status, code, message) {
    res.status(status).json({
        jsonrpc: "2.0",
        error: { code, message },
        id: null,
    });
}
async function startStdioServer() {
    const server = createMindosServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`MindOS MCP Server running via stdio (MIND_ROOT=${MIND_ROOT})\n`);
}
async function startHttpServer() {
    if (!Number.isInteger(MCP_PORT) || MCP_PORT <= 0 || MCP_PORT > 65535) {
        throw new Error(`Invalid MCP_PORT: ${process.env.MCP_PORT}`);
    }
    const app = createMcpExpressApp({ host: MCP_HOST });
    const sessions = {};
    app.get("/healthz", (_req, res) => {
        res.status(200).json({ status: "ok", transport: "streamable-http" });
    });
    app.all(MCP_ENDPOINT, async (req, res) => {
        const authHeader = Array.isArray(req.headers.authorization)
            ? req.headers.authorization[0]
            : req.headers.authorization;
        if (!isAuthorized(authHeader)) {
            sendJsonRpcError(res, 401, -32001, "Unauthorized: invalid AUTH_TOKEN bearer token");
            return;
        }
        if (!MCP_HTTP_STATEFUL) {
            const server = createMindosServer();
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            try {
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
            }
            catch (err) {
                process.stderr.write(`HTTP transport error: ${err}\n`);
                if (!res.headersSent) {
                    sendJsonRpcError(res, 500, -32603, "Internal server error");
                }
            }
            finally {
                res.on("close", () => {
                    void transport.close();
                    void server.close();
                });
            }
            return;
        }
        try {
            const rawSessionId = req.headers["mcp-session-id"];
            const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
            let transport;
            if (sessionId) {
                transport = sessions[sessionId]?.transport;
            }
            else if (req.method === "POST" && isInitializeRequest(req.body)) {
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (newSessionId) => {
                        sessions[newSessionId] = { transport: transport, server };
                    },
                });
                transport.onclose = () => {
                    const sid = transport?.sessionId;
                    if (sid) {
                        const session = sessions[sid];
                        if (session) {
                            void session.server.close();
                            delete sessions[sid];
                        }
                    }
                };
                const server = createMindosServer();
                await server.connect(transport);
            }
            if (!transport) {
                sendJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided");
                return;
            }
            await transport.handleRequest(req, res, req.body);
        }
        catch (err) {
            process.stderr.write(`HTTP transport error: ${err}\n`);
            if (!res.headersSent) {
                sendJsonRpcError(res, 500, -32603, "Internal server error");
            }
        }
    });
    await new Promise((resolve, reject) => {
        const httpServer = app.listen(MCP_PORT, MCP_HOST, () => resolve());
        httpServer.on("error", reject);
    });
    process.stderr.write(`MindOS MCP Server running via Streamable HTTP at http://${MCP_HOST}:${MCP_PORT}${MCP_ENDPOINT} (stateful=${MCP_HTTP_STATEFUL})\n`);
}
async function main() {
    if (MCP_TRANSPORT === "stdio") {
        await startStdioServer();
        return;
    }
    if (MCP_TRANSPORT === "http" || MCP_TRANSPORT === "streamable-http") {
        await startHttpServer();
        return;
    }
    throw new Error(`Unsupported MCP_TRANSPORT: ${MCP_TRANSPORT}. Use "stdio" or "http".`);
}
main().catch((err) => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map