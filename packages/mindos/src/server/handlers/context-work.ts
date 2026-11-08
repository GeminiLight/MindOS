import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { posix, join } from "node:path";
import {
  safeFolder,
  requireFolder,
  readDocument,
  checkedPath,
} from "../../knowledge/views/paths.js";
import { ViewError } from "../../knowledge/views/types.js";
import { validateText } from "../../knowledge/views/markdown.js";
import { mindRootIdentity } from "../root-identity.js";
import { json } from "../response.js";
import type { MindosHttpServices } from "../services.js";
import { handleFilePost } from "./file.js";
import { recordKnowledgeWrite } from "../routes/files.js";
import { viewsError } from "./views.js";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const revision = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Progress = {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  digest: string;
  path: string;
  text: string;
};

function noSymlinks(root: string, path: string) {
  let current = root;
  for (const segment of path.split("/")) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new ViewError(
        "ACCESS_DENIED",
        "Symbolic links are not included in this Context",
        403,
      );
  }
}
function scope(root: string, rootId: unknown, folder: unknown) {
  if (rootId !== mindRootIdentity(root))
    throw new ViewError("ROOT_CHANGED", "The knowledge library changed", 409);
  const safe = safeFolder(root, folder);
  noSymlinks(root, safe);
  requireFolder(root, safe);
  return safe;
}
function documentPath(root: string, folder: string, value: unknown) {
  const path = validateText(value, "Path", 1000, true, true);
  if (
    !path.startsWith(folder + "/") ||
    path.split("/").some((p) => !p || p.startsWith(".")) ||
    path.includes("\\") ||
    !/\.(md|txt|csv|json)$/i.test(path)
  ) {
    throw new ViewError(
      "ACCESS_DENIED",
      "Choose a text file inside this Context",
      403,
    );
  }
  checkedPath(root, path);
  noSymlinks(root, path);
  return path;
}
function read(root: string, folder: string, path: unknown) {
  const safe = documentPath(root, folder, path);
  if (!existsSync(checkedPath(root, safe)))
    throw new ViewError("FILE_MISSING", "The file was moved or removed", 404);
  const content = readDocument(root, safe);
  return { path: safe, content, revision: revision(content) };
}
function progressFrom(path: string, content: string): Progress | null {
  const match = /^<!-- mindos-progress (.+) -->\n/.exec(content);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1]!);
    if (
      !uuid.test(meta.id) ||
      !/^[a-f0-9]{64}$/.test(meta.digest) ||
      typeof meta.source !== "string" ||
      typeof meta.title !== "string" ||
      !Number.isFinite(Date.parse(meta.createdAt))
    )
      return null;
    const body = content
      .slice(match[0].length)
      .replace(/^# [^\n]*\n\n来源：[^\n]*\n\n/, "")
      .trim();
    return {
      id: meta.id,
      title: meta.title.slice(0, 120),
      source: meta.source.slice(0, 80),
      createdAt: meta.createdAt,
      digest: meta.digest,
      path,
      text: body,
    };
  } catch {
    return null;
  }
}
function list(root: string, folder: string) {
  const files: Array<{ path: string; name: string; size: number }> = [];
  const progress: Progress[] = [];
  let scanned = 0,
    limited = false,
    skipped = 0;
  function walk(dir: string, depth: number) {
    if (depth > 4) {
      limited = true;
      return;
    }
    for (const entry of readdirSync(checkedPath(root, dir), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++scanned > 1500 || files.length >= 300) {
        limited = true;
        return;
      }
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) {
        skipped++;
        continue;
      }
      const path = posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.(md|txt|csv|json)$/i.test(path)) continue;
      try {
        const size = lstatSync(checkedPath(root, path)).size;
        files.push({ path, name: entry.name, size });
        if (path.startsWith(folder + "/进展/") && size <= 32_000) {
          const note = progressFrom(path, readDocument(root, path));
          if (note) progress.push(note);
        }
      } catch {
        skipped++;
      }
    }
  }
  walk(folder, 0);
  progress.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { folder, files, progress: progress.slice(0, 30), limited, skipped };
}

export function handleContextWorkGet(
  query: URLSearchParams,
  services: MindosHttpServices,
) {
  try {
    const root = services.mindRoot,
      rootId = mindRootIdentity(root);
    const folder = scope(root, query.get("rootId"), query.get("folder"));
    const op = query.get("op") || "list";
    if (op === "read")
      return json(
        { rootId, ...read(root, folder, query.get("path")) },
        { headers },
      );
    if (op === "list")
      return json({ rootId, ...list(root, folder) }, { headers });
    throw new ViewError("INVALID_INPUT", "Unknown Context operation");
  } catch (error) {
    return viewsError(error);
  }
}

export async function handleContextWorkPost(
  body: unknown,
  services: MindosHttpServices,
  requestHeaders = new Headers(),
  signal?: AbortSignal,
) {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ViewError("INVALID_INPUT", "Invalid Context request");
    const b = body as Record<string, unknown>,
      root = services.mindRoot,
      rootId = mindRootIdentity(root);
    const folder = scope(root, b.expectedRootId, b.folder);
    if (b.op === "prepare") {
      const goal = validateText(b.goal, "Goal", 2000, true);
      const target = validateText(b.target, "Agent", 80, true, true);
      if (
        !Array.isArray(b.selected) ||
        !b.selected.length ||
        b.selected.length > 12
      )
        throw new ViewError("INVALID_INPUT", "Choose 1–12 documents");
      const seen = new Set<string>();
      let size = 0;
      const items = b.selected.map((item: unknown) => {
        if (!item || typeof item !== "object")
          throw new ViewError("INVALID_INPUT", "Invalid document selection");
        const selected = item as Record<string, unknown>,
          doc = read(root, folder, selected.path);
        if (seen.has(doc.path))
          throw new ViewError("INVALID_INPUT", "Duplicate document");
        seen.add(doc.path);
        if (doc.revision !== selected.revision)
          throw new ViewError(
            "REVISION_CONFLICT",
            "A selected file changed. Review the latest version",
            409,
          );
        size += Buffer.byteLength(doc.content);
        if (size > 512 * 1024)
          throw new ViewError(
            "DOCUMENT_TOO_LARGE",
            "Choose fewer documents",
            413,
          );
        return doc;
      });
      const zh = b.locale !== "en";
      const text = `${zh ? "# 交给" : "# Context for"} ${target}\n\nContext: ${folder}\n\n## ${zh ? "本次目标" : "Goal"}\n${goal}\n\n${items.map((d) => `## ${d.path}\n\n${d.content}`).join("\n\n")}\n\n---\n${zh ? "这是由用户选择的资料。请先提出建议，等待确认后再执行。" : "These materials were selected by the user. Propose next steps and wait for confirmation before taking action."}`;
      return json({ rootId, items, text }, { headers });
    }
    if (b.op !== "progress")
      throw new ViewError("INVALID_INPUT", "Unknown Context operation");
    if (typeof b.operationId !== "string" || !uuid.test(b.operationId))
      throw new ViewError("INVALID_INPUT", "Invalid operation identity");
    const text = validateText(b.text, "Progress", 4000, true),
      source = validateText(b.source, "Source", 80, true, true);
    const path = `${folder}/进展/${b.operationId}.md`;
    documentPath(root, folder, path);
    const digest = revision(JSON.stringify([text, source]));
    const existing = () => {
      if (!existsSync(checkedPath(root, path))) return null;
      const note = progressFrom(path, readDocument(root, path));
      if (!note || note.digest !== digest || note.text !== text)
        throw new ViewError(
          "REVISION_CONFLICT",
          "The saved progress differs from this request",
          409,
        );
      return note;
    };
    const previous = existing();
    if (previous)
      return json({ rootId, path, progress: previous }, { headers });
    if (signal?.aborted)
      throw new ViewError(
        "REQUEST_CANCELLED",
        "The request was cancelled",
        499,
      );
    const meta = {
      id: b.operationId,
      title: (text.split("\n")[0] ?? "").replace(/^#+\s*/, "").slice(0, 80),
      source,
      createdAt: new Date().toISOString(),
      digest,
    };
    const content = `<!-- mindos-progress ${JSON.stringify(meta).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")} -->\n# ${meta.title}\n\n来源：${source}\n\n${text}\n`;
    const result = await handleFilePost(
      { op: "create_file", path, content, expectedRootId: rootId },
      { mindRoot: root },
      {
        sourceHeader: requestHeaders.get("x-mindos-source"),
        agentHeader: requestHeaders.get("x-mindos-agent"),
        protectedRootFiles: services.knowledgeWrites?.protectedRootFiles,
      },
    );
    recordKnowledgeWrite(services, result, undefined);
    if (result.status >= 400) {
      // A response lost after a successful exclusive create is safe to retry.
      if (result.status === 409) {
        const retried = existing();
        if (retried)
          return json({ rootId, path, progress: retried }, { headers });
      }
      throw new ViewError(
        result.status === 403 ? "ACCESS_DENIED" : "WRITE_FAILED",
        "Progress could not be saved; your input is preserved",
        result.status,
      );
    }
    return json(
      { rootId, path, progress: progressFrom(path, content) },
      { headers },
    );
  } catch (error) {
    return viewsError(error);
  }
}
