import { lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { WorkSnapshot } from "./service.js";
import { WorkViewsService } from "./service.js";
import { taskPeople } from "./relationships.js";
import type { PageSpec, PageBlock } from "./page-spec.js";
import { checkedPath, safeFolder, readDocument } from "./paths.js";
import { ViewError, type ViewDefinition } from "./types.js";
import {
  defaultSpec,
  projectView,
  validateViewSpec,
  type ViewSpec,
} from "./view-spec.js";
export type PageBlockData = {
  blockId: string;
  data?: WorkSnapshot & { spec: ViewSpec; view?: ViewDefinition };
  notes?: Array<{ path: string; title: string; content: string }>;
  error?: { code: string; message: string };
  limited: boolean;
};
const MAX_NOTE_BYTES = 16 * 1024;
function assertNotePath(root: string, path: string) {
  checkedPath(root, path);
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new ViewError(
        "ACCESS_DENIED",
        "Notes cannot be loaded through symbolic links",
        403,
      );
  }
}
function notes(
  root: string,
  block: PageBlock,
): Pick<PageBlockData, "notes" | "limited"> {
  let paths = block.paths ? [...block.paths] : [];
  let limited = false;
  if (block.folder) {
    const folder = safeFolder(root, block.folder);
    assertNotePath(root, folder);
    const entries = readdirSync(checkedPath(root, folder), {
      withFileTypes: true,
    }).filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        /\.md$/i.test(entry.name),
    );
    limited = entries.length > Math.min(block.limit ?? 10, 10);
    // Stat a bounded candidate set; an unusually large folder is explicitly partial.
    const candidates = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 100);
    paths = candidates
      .map((entry) => ({
        path: folder + "/" + entry.name,
        time: lstatSync(checkedPath(root, folder + "/" + entry.name)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time || a.path.localeCompare(b.path))
      .map((entry) => entry.path);
  }
  const limit = Math.min(block.limit ?? 10, 10);
  limited ||= paths.length > limit;
  const items = paths.slice(0, limit).map((path) => {
    if (!/\.md$/i.test(path))
      throw new ViewError("INVALID_NOTE", "Choose Markdown note files");
    assertNotePath(root, path);
    const content = readDocument(root, path);
    const raw = Buffer.from(content);
    const clipped = raw.byteLength > MAX_NOTE_BYTES;
    limited ||= clipped;
    // Slice code points rather than bytes so Unicode is not split in the preview.
    let preview = content;
    if (clipped) {
      preview = "";
      let size = 0;
      for (const ch of content) {
        size += Buffer.byteLength(ch);
        if (size > MAX_NOTE_BYTES) break;
        preview += ch;
      }
    }
    return {
      path,
      title: content.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path, ".md"),
      content: preview,
    };
  });
  return { notes: items, limited };
}
export function renderPageData(
  root: string,
  service: WorkViewsService,
  spec: PageSpec,
): PageBlockData[] {
  // Share collection reads among blocks; generated pages must not cause N+1 scans.
  const snapshots = new Map<string, WorkSnapshot>();
  let index: ReturnType<WorkViewsService["list"]> | undefined;
  const result: PageBlockData[] = spec.blocks.map((block) => {
    try {
      if (block.kind === "notes")
        return { blockId: block.id, ...notes(root, block) };
      if (!block.collectionId && !block.viewId)
        return { blockId: block.id, limited: false };
      index ??= service.list();
      const views = index.views;
      const view = block.viewId
        ? views.find((v) => v.id === block.viewId)
        : undefined;
      if (block.viewId && !view)
        throw new ViewError(
          "VIEW_MISSING",
          "The saved view no longer exists",
          404,
        );
      const id = block.collectionId ?? view!.collectionId!;
      if (view && view.collectionId !== id)
        throw new ViewError(
          "INVALID_PAGE",
          "The view belongs to a different collection",
        );
      let snapshot = snapshots.get(id);
      if (!snapshot) {
        snapshot = service.read(id, false);
        snapshots.set(id, snapshot);
      }
      if (
        (block.kind === "tasks" || block.kind === "people") &&
        snapshot.collection.template !== block.kind
      )
        throw new ViewError(
          "INVALID_PAGE",
          "The block and collection types do not match",
        );
      const base = view?.spec ?? defaultSpec(id, snapshot.collection.template);
      // A block can narrow the saved projection, never expand it.
      const fields = block.fields ?? base.fields;
      if (view && fields.some((field) => !base.fields.includes(field)))
        throw new ViewError(
          "INVALID_PAGE",
          "The block includes fields hidden by its saved view",
        );
      const layout = block.layout ?? base.layout;
      const display = validateViewSpec(
        {
          ...base,
          fields,
          layout,
          groupBy: layout === "board" ? (base.groupBy ?? "status") : undefined,
          filter: block.filter,
        },
        snapshot.fields,
      );
      const sourceRecords = projectView(base, snapshot.records);
      const filtered = projectView(display, sourceRecords);
      const limit = block.limit ?? 50;
      const effectiveView = view ? { ...view, spec: display } : undefined;
      return {
        blockId: block.id,
        limited:
          snapshot.limited || snapshot.skipped > 0 || filtered.length > limit,
        data: {
          ...snapshot,
          records: filtered.slice(0, limit),
          spec: display,
          ...(effectiveView ? { view: effectiveView } : {}),
        },
      };
    } catch (error) {
      return {
        blockId: block.id,
        limited: true,
        error:
          error instanceof ViewError
            ? { code: error.code, message: error.message }
            : {
                code: "SOURCE_UNAVAILABLE",
                message:
                  "This source could not be read. Your original data is unchanged.",
              },
      };
    }
  });
  if (index) {
    // Resolve names once across the page, not once per task block or task collection.
    const records = result.flatMap((block) =>
      block.data?.collection.template === "tasks" ? block.data.records : [],
    );
    const names = taskPeople(
      root,
      index,
      records.map((record) => record.fields.personRef ?? ""),
    );
    for (const record of records)
      Object.assign(record, names.get(record.fields.personRef ?? ""));
  }
  return result;
}
