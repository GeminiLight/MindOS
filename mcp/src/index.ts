/**
 * MindOS MCP Server — HTTP client wrapper
 *
 * Pure protocol adapter: maps MCP tools to App REST API calls via fetch.
 * Zero business logic — all operations delegated to the App.
 *
 * Transport modes:
 *   Streamable HTTP (default):
 *     mindos mcp
 *
 *   stdio:
 *     MCP_TRANSPORT=stdio mindos mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL       = process.env.MINDOS_URL      ?? "http://localhost:3456";
const AUTH_TOKEN     = process.env.AUTH_TOKEN;
const MCP_TRANSPORT  = process.env.MCP_TRANSPORT   ?? "http";    // "http" | "stdio"
const MCP_HOST       = process.env.MCP_HOST        ?? "0.0.0.0";
const MCP_PORT       = parseInt(process.env.MCP_PORT ?? "8781", 10);
const MCP_ENDPOINT   = process.env.MCP_ENDPOINT    ?? "/mcp";
const CHARACTER_LIMIT = 25_000;

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) h["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function get(path: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), { headers: headers() });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as string) ?? `HTTP ${res.status}`);
  return json;
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(new URL(path, BASE_URL).toString(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as string) ?? `HTTP ${res.status}`);
  return json;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function error(msg: string) {
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
}

function truncate(text: string, limit = CHARACTER_LIMIT): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n[... truncated at ${limit} characters. Use offset/limit params for paginated access.]`;
}

// ─── Agent operation logging ────────────────────────────────────────────────

async function logOp(tool: string, params: Record<string, unknown>, result: 'ok' | 'error', message: string) {
  try {
    const entry = { ts: new Date().toISOString(), tool, params, result, message: message.slice(0, 200) };
    const line = JSON.stringify(entry) + '\n';
    // Append to .agent-log.json via the app API
    await fetch(new URL("/api/file", BASE_URL).toString(), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ op: "append_to_file", path: ".agent-log.json", content: line }),
    }).catch(() => {});
  } catch {
    // Logging should never break tool execution
  }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({ name: "mindos-mcp-server", version: "1.0.0" });

// ── mindos_list_files ───────────────────────────────────────────────────────

server.registerTool("mindos_list_files", {
  title: "List Knowledge Base Files",
  description: "Return the full file tree of the MindOS knowledge base as a directory tree.",
  inputSchema: z.object({
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  }),
  annotations: { readOnlyHint: true },
}, async ({ response_format }) => {
  try {
    const json = await get("/api/files", { format: response_format });
    const result = typeof json.tree === "string" ? json.tree : JSON.stringify(json.tree ?? json, null, 2);
    logOp("mindos_list_files", { response_format }, "ok", `${result.length} chars`);
    return ok(result);
  } catch (e) { logOp("mindos_list_files", { response_format }, "error", String(e)); return error(String(e)); }
});

// ── mindos_read_file ────────────────────────────────────────────────────────

server.registerTool("mindos_read_file", {
  title: "Read File Content",
  description: "Read the full content of a file in the MindOS knowledge base.",
  inputSchema: z.object({
    path: z.string().min(1),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(CHARACTER_LIMIT).default(CHARACTER_LIMIT),
  }),
  annotations: { readOnlyHint: true },
}, async ({ path, offset, limit }) => {
  try {
    const json = await get("/api/file", { path, op: "read_file" });
    const content = json.content as string;
    const slice = content.slice(offset, offset + limit);
    const hasMore = offset + limit < content.length;
    const header = hasMore
      ? `[Showing characters ${offset}–${offset + slice.length} of ${content.length}. Use offset=${offset + limit} for next page.]\n\n`
      : offset > 0 ? `[Showing characters ${offset}–${offset + slice.length} of ${content.length}]\n\n` : "";
    logOp("mindos_read_file", { path }, "ok", `${content.length} chars`);
    return ok(header + slice);
  } catch (e) { logOp("mindos_read_file", { path }, "error", String(e)); return error(String(e)); }
});

// ── mindos_write_file ───────────────────────────────────────────────────────

server.registerTool("mindos_write_file", {
  title: "Write File Content",
  description: "Overwrite the entire content of an existing file.",
  inputSchema: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
}, async ({ path, content }) => {
  try {
    await post("/api/file", { op: "save_file", path, content });
    logOp("mindos_write_file", { path }, "ok", `Wrote ${content.length} chars`);
    return ok(`Successfully wrote ${content.length} characters to "${path}"`);
  } catch (e) { logOp("mindos_write_file", { path }, "error", String(e)); return error(String(e)); }
});

// ── mindos_create_file ──────────────────────────────────────────────────────

server.registerTool("mindos_create_file", {
  title: "Create New File",
  description: "Create a new file in the knowledge base. Only .md and .csv files allowed.",
  inputSchema: z.object({
    path: z.string().min(1).regex(/\.(md|csv)$/),
    content: z.string().default(""),
  }),
}, async ({ path, content }) => {
  try {
    await post("/api/file", { op: "create_file", path, content });
    logOp("mindos_create_file", { path }, "ok", `Created ${content.length} chars`);
    return ok(`Created "${path}" (${content.length} characters)`);
  } catch (e) { logOp("mindos_create_file", { path }, "error", String(e)); return error(String(e)); }
});

// ── mindos_create_space ─────────────────────────────────────────────────────

server.registerTool("mindos_create_space", {
  title: "Create Mind Space",
  description:
    "Create a new Mind Space (top-level or under parent_path): directory + README.md + INSTRUCTION.md scaffold. Use this instead of create_file when adding a new cognitive zone to the knowledge base.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Space directory name (no path separators)"),
    description: z.string().default("").describe("Short purpose text stored in README.md"),
    parent_path: z.string().default("").describe("Optional parent directory under MIND_ROOT (empty = top-level Space)"),
  }),
}, async ({ name, description, parent_path }) => {
  try {
    const json = await post("/api/file", {
      op: "create_space",
      path: "_",
      name,
      description,
      parent_path,
    });
    const p = json.path as string;
    logOp("mindos_create_space", { name, parent_path }, "ok", p);
    return ok(`Created Mind Space at "${p}"`);
  } catch (e) {
    logOp("mindos_create_space", { name, parent_path }, "error", String(e));
    return error(String(e));
  }
});

// ── mindos_rename_space ─────────────────────────────────────────────────────

server.registerTool("mindos_rename_space", {
  title: "Rename Mind Space",
  description:
    "Rename a Space directory (relative path to the folder, e.g. Notes or Work/Notes). Only the final folder name changes; new_name must be a single segment. Does not rewrite links inside files.",
  inputSchema: z.object({
    path: z.string().min(1).describe("Relative path to the space directory to rename"),
    new_name: z.string().min(1).describe("New folder name only (no slashes)"),
  }),
}, async ({ path: spacePath, new_name }) => {
  try {
    const json = await post("/api/file", { op: "rename_space", path: spacePath, new_name });
    logOp("mindos_rename_space", { path: spacePath, new_name }, "ok", String(json.newPath));
    return ok(`Renamed space "${spacePath}" → "${json.newPath}"`);
  } catch (e) {
    logOp("mindos_rename_space", { path: spacePath, new_name }, "error", String(e));
    return error(String(e));
  }
});

// ── mindos_delete_file ──────────────────────────────────────────────────────

server.registerTool("mindos_delete_file", {
  title: "Delete File",
  description: "Permanently delete a file from the knowledge base.",
  inputSchema: z.object({
    path: z.string().min(1),
  }),
  annotations: { destructiveHint: true },
}, async ({ path }) => {
  try {
    await post("/api/file", { op: "delete_file", path });
    logOp("mindos_delete_file", { path }, "ok", `Deleted "${path}"`);
    return ok(`Deleted "${path}"`);
  } catch (e) { logOp("mindos_delete_file", { path }, "error", String(e)); return error(String(e)); }
});

// ── mindos_rename_file ──────────────────────────────────────────────────────

server.registerTool("mindos_rename_file", {
  title: "Rename File",
  description: "Rename a file within its current directory.",
  inputSchema: z.object({
    path: z.string().min(1),
    new_name: z.string().min(1),
  }),
}, async ({ path, new_name }) => {
  try {
    const json = await post("/api/file", { op: "rename_file", path, new_name });
    return ok(`Renamed "${path}" → "${json.newPath}"`);
  } catch (e) { return error(String(e)); }
});

// ── mindos_move_file ────────────────────────────────────────────────────────

server.registerTool("mindos_move_file", {
  title: "Move File",
  description: "Move a file to a new path. Returns affected backlinks.",
  inputSchema: z.object({
    from_path: z.string().min(1),
    to_path: z.string().min(1),
  }),
}, async ({ from_path, to_path }) => {
  try {
    const json = await post("/api/file", { op: "move_file", path: from_path, to_path });
    const affected = json.affectedFiles as string[] ?? [];
    const lines = [`Moved "${from_path}" → "${json.newPath}"`];
    if (affected.length > 0) {
      lines.push("", `${affected.length} file(s) reference the old path:`);
      for (const f of affected) lines.push(`  - ${f}`);
    }
    return ok(lines.join("\n"));
  } catch (e) { return error(String(e)); }
});

// ── mindos_search_notes ─────────────────────────────────────────────────────

server.registerTool("mindos_search_notes", {
  title: "Search Knowledge Base",
  description: "Full-text search across all .md and .csv files.",
  inputSchema: z.object({
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(50).default(20),
    scope: z.string().optional(),
    file_type: z.enum(["md", "csv", "all"]).default("all"),
    modified_after: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  }),
  annotations: { readOnlyHint: true },
}, async ({ query, limit, scope, file_type, modified_after, response_format }) => {
  try {
    const params: Record<string, string> = { q: query, limit: String(limit) };
    if (scope) params.scope = scope;
    if (file_type !== "all") params.file_type = file_type;
    if (modified_after) params.modified_after = modified_after;
    if (response_format) params.format = response_format;
    const json = await get("/api/search", params);
    logOp("mindos_search_notes", { query, limit }, "ok", `Search completed`);
    return ok(truncate(JSON.stringify(json, null, 2)));
  } catch (e) { logOp("mindos_search_notes", { query }, "error", String(e)); return error(String(e)); }
});

// ── mindos_get_recent ───────────────────────────────────────────────────────

server.registerTool("mindos_get_recent", {
  title: "Get Recently Modified Files",
  description: "Return recently modified files sorted by modification time.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).default(10),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  }),
  annotations: { readOnlyHint: true },
}, async ({ limit, response_format }) => {
  try {
    const json = await get("/api/recent-files", { limit: String(limit), format: response_format });
    return ok(JSON.stringify(json, null, 2));
  } catch (e) { return error(String(e)); }
});

// ── mindos_read_lines ───────────────────────────────────────────────────────

server.registerTool("mindos_read_lines", {
  title: "Read File as Lines",
  description: "Read file content as a numbered array of lines (0-indexed).",
  inputSchema: z.object({
    path: z.string().min(1),
  }),
  annotations: { readOnlyHint: true },
}, async ({ path }) => {
  try {
    const json = await get("/api/file", { path, op: "read_lines" });
    const lines = json.lines as string[];
    const numbered = lines.map((l, i) => `${i}: ${l}`).join("\n");
    return ok(`${lines.length} lines total:\n\n${numbered}`);
  } catch (e) { return error(String(e)); }
});

// ── mindos_insert_lines ─────────────────────────────────────────────────────

server.registerTool("mindos_insert_lines", {
  title: "Insert Lines into File",
  description: "Insert lines at a specific position (0-based, -1 to prepend).",
  inputSchema: z.object({
    path: z.string().min(1),
    after_index: z.number().int(),
    lines: z.array(z.string()).min(1),
  }),
}, async ({ path, after_index, lines }) => {
  try {
    await post("/api/file", { op: "insert_lines", path, after_index, lines });
    return ok(`Inserted ${lines.length} line(s) after index ${after_index} in "${path}"`);
  } catch (e) { return error(String(e)); }
});

// ── mindos_update_lines ─────────────────────────────────────────────────────

server.registerTool("mindos_update_lines", {
  title: "Replace Lines in File",
  description: "Replace a range of lines (inclusive, 0-based).",
  inputSchema: z.object({
    path: z.string().min(1),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    lines: z.array(z.string()).min(1),
  }),
}, async ({ path, start, end, lines }) => {
  try {
    await post("/api/file", { op: "update_lines", path, start, end, lines });
    return ok(`Replaced lines ${start}–${end} in "${path}" with ${lines.length} new line(s)`);
  } catch (e) { return error(String(e)); }
});

// ── mindos_append_to_file ───────────────────────────────────────────────────

server.registerTool("mindos_append_to_file", {
  title: "Append Content to File",
  description: "Append text to the end of an existing file.",
  inputSchema: z.object({
    path: z.string().min(1),
    content: z.string().min(1),
  }),
}, async ({ path, content }) => {
  try {
    await post("/api/file", { op: "append_to_file", path, content });
    logOp("mindos_append_to_file", { path }, "ok", `Appended ${content.length} chars`);
    return ok(`Appended ${content.length} character(s) to "${path}"`);
  } catch (e) { logOp("mindos_append_to_file", { path }, "error", String(e)); return error(String(e)); }
});

// ── mindos_insert_after_heading ─────────────────────────────────────────────

server.registerTool("mindos_insert_after_heading", {
  title: "Insert Content After Heading",
  description: "Insert content after a Markdown heading.",
  inputSchema: z.object({
    path: z.string().min(1),
    heading: z.string().min(1),
    content: z.string().min(1),
  }),
}, async ({ path, heading, content }) => {
  try {
    await post("/api/file", { op: "insert_after_heading", path, heading, content });
    logOp("mindos_insert_after_heading", { path, heading }, "ok", `Inserted after "${heading}"`);
    return ok(`Inserted content after heading "${heading}" in "${path}"`);
  } catch (e) { logOp("mindos_insert_after_heading", { path, heading }, "error", String(e)); return error(String(e)); }
});

// ── mindos_update_section ───────────────────────────────────────────────────

server.registerTool("mindos_update_section", {
  title: "Replace Markdown Section Content",
  description: "Replace the content of a Markdown section identified by heading.",
  inputSchema: z.object({
    path: z.string().min(1),
    heading: z.string().min(1),
    content: z.string(),
  }),
}, async ({ path, heading, content }) => {
  try {
    await post("/api/file", { op: "update_section", path, heading, content });
    logOp("mindos_update_section", { path, heading }, "ok", `Updated section "${heading}"`);
    return ok(`Updated section "${heading}" in "${path}"`);
  } catch (e) { logOp("mindos_update_section", { path, heading }, "error", String(e)); return error(String(e)); }
});

// ── mindos_append_csv ───────────────────────────────────────────────────────

server.registerTool("mindos_append_csv", {
  title: "Append Row to CSV",
  description: "Append a row to a CSV file with RFC 4180 escaping.",
  inputSchema: z.object({
    path: z.string().min(1).regex(/\.csv$/),
    row: z.array(z.string()).min(1),
  }),
}, async ({ path, row }) => {
  try {
    const json = await post("/api/file", { op: "append_csv", path, row });
    return ok(`Appended row to "${path}". File now has ${json.newRowCount} rows.`);
  } catch (e) { return error(String(e)); }
});

// ── mindos_get_backlinks ────────────────────────────────────────────────────

server.registerTool("mindos_get_backlinks", {
  title: "Find Backlinks to File",
  description: "Find all files that reference a given file path.",
  inputSchema: z.object({
    path: z.string().min(1),
  }),
  annotations: { readOnlyHint: true },
}, async ({ path }) => {
  try {
    const json = await get("/api/backlinks", { path });
    return ok(JSON.stringify(json, null, 2));
  } catch (e) { return error(String(e)); }
});

// ── mindos_bootstrap ────────────────────────────────────────────────────────

server.registerTool("mindos_bootstrap", {
  title: "Bootstrap Agent Context",
  description: "Load MindOS startup context: INSTRUCTION.md, README.md, CONFIG files, and optional target directory context.",
  inputSchema: z.object({
    target_dir: z.string().optional(),
  }),
  annotations: { readOnlyHint: true },
}, async ({ target_dir }) => {
  try {
    const params: Record<string, string> = {};
    if (target_dir) params.target_dir = target_dir;
    const json = await get("/api/bootstrap", params);
    const sections = Object.entries(json)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([key, val]) => `--- ${key} ---\n\n${val}`)
      .join("\n\n");
    return ok(truncate(sections));
  } catch (e) { return error(String(e)); }
});

// ── mindos_get_history ──────────────────────────────────────────────────────

server.registerTool("mindos_get_history", {
  title: "Get File Git History",
  description: "Get git commit history for a file.",
  inputSchema: z.object({
    path: z.string().min(1),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  annotations: { readOnlyHint: true },
}, async ({ path, limit }) => {
  try {
    const json = await get("/api/git", { op: "history", path, limit: String(limit) });
    const entries = json.entries as Array<{ hash: string; date: string; message: string; author: string }>;
    if (entries.length === 0) return ok(`No git history found for "${path}"`);
    const lines = [`# Git History: ${path}`, "", `${entries.length} commit(s):`, ""];
    for (const h of entries) {
      lines.push(`- **${h.date}** \`${h.hash.slice(0, 8)}\` — ${h.message} (${h.author})`);
    }
    return ok(lines.join("\n"));
  } catch (e) { return error(String(e)); }
});

// ── mindos_get_file_at_version ──────────────────────────────────────────────

server.registerTool("mindos_get_file_at_version", {
  title: "Read File at Git Version",
  description: "Read file content at a specific git commit.",
  inputSchema: z.object({
    path: z.string().min(1),
    commit: z.string().min(4),
  }),
  annotations: { readOnlyHint: true },
}, async ({ path, commit }) => {
  try {
    const json = await get("/api/git", { op: "show", path, commit });
    const content = json.content as string;
    return ok(truncate(`# ${path} @ ${commit.slice(0, 8)}\n\n${content}`));
  } catch (e) { return error(String(e)); }
});

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  if (MCP_TRANSPORT === "http") {
    // ── Streamable HTTP mode ──────────────────────────────────────────────
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const expressApp = createMcpExpressApp({ host: MCP_HOST });

    // Health endpoint — allows check-port to detect this is a MindOS MCP instance
    expressApp.get("/api/health", (_req, res) => {
      res.json({ ok: true, service: "mindos" });
    });

    // Auth middleware
    if (AUTH_TOKEN) {
      expressApp.use(MCP_ENDPOINT, (req, res, next) => {
        const bearer = req.headers.authorization?.replace("Bearer ", "");
        if (bearer !== AUTH_TOKEN) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        next();
      });
    }

    expressApp.all(MCP_ENDPOINT, async (req, res) => {
      // Pass pre-parsed body: express.json() already parsed it, SDK >= 1.7 expects it as 3rd arg
      await transport.handleRequest(req, res, req.body);
    });

    await server.connect(transport);

    const httpServer = createServer(expressApp as Parameters<typeof createServer>[1]);
    httpServer.listen(MCP_PORT, MCP_HOST, () => {
      const displayHost = MCP_HOST === '0.0.0.0' ? '127.0.0.1' : MCP_HOST;
      console.error(`MindOS MCP server (HTTP) listening on http://${displayHost}:${MCP_PORT}${MCP_ENDPOINT}`);
      console.error(`API backend: ${BASE_URL}`);
    });
  } else {
    // ── stdio mode (default) ──────────────────────────────────────────────
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`MindOS MCP server started (stdio, API: ${BASE_URL})`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
