import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { posix, basename } from "node:path";
import {
  resolveExistingSafe,
  resolveSafe,
} from "../../foundation/security/index.js";
import {
  ViewError,
  type PersonDocument,
  type PersonSummary,
  type ViewFile,
} from "./types.js";
import { isPersonDocument, parsePerson, validateText } from "./markdown.js";
export const MAX_DOCUMENT_BYTES = 256 * 1024;
export function safeFolder(
  root: string,
  value: unknown,
  validateFilesystem = true,
): string {
  const folder = validateText(value, "Folder", 240, true, true).replaceAll(
    "\\",
    "/",
  );
  if (
    folder.startsWith("/") ||
    /^[a-z]:/i.test(folder) ||
    folder
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p.startsWith("."))
  )
    throw new ViewError(
      "INVALID_FOLDER",
      "Choose a folder inside the knowledge library",
    );
  try {
    if (validateFilesystem) resolveExistingSafe(root, folder);
    else resolveSafe(root, folder);
  } catch {
    throw new ViewError(
      "ACCESS_DENIED",
      "The folder is outside the allowed library",
      403,
    );
  }
  return folder;
}
export function checkedPath(root: string, path: string): string {
  try {
    return resolveExistingSafe(root, path);
  } catch {
    throw new ViewError(
      "ACCESS_DENIED",
      "This file is outside the allowed library",
      403,
    );
  }
}
export function requireFolder(root: string, folder: string): string {
  const abs = checkedPath(root, folder);
  try {
    if (!lstatSync(abs).isDirectory())
      throw new ViewError("INVALID_FOLDER", "Choose a directory");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new ViewError("FOLDER_MISSING", "The bound folder is missing", 404);
    if (e instanceof ViewError) throw e;
    throw new ViewError("ACCESS_DENIED", "The folder is unavailable", 403);
  }
  return abs;
}
export function readDocument(root: string, path: string): string {
  const file = checkedPath(root, path);
  try {
    const stat = lstatSync(file);
    if (!stat.isFile())
      throw new ViewError(
        "ACCESS_DENIED",
        "Only ordinary files can be opened",
        403,
      );
    if (stat.size > MAX_DOCUMENT_BYTES)
      throw new ViewError(
        "DOCUMENT_TOO_LARGE",
        "Open this document in the file editor",
        413,
      );
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
  } catch (e) {
    if (e instanceof ViewError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new ViewError(
        "PERSON_MISSING",
        "The original file was moved or removed",
        404,
      );
    throw new ViewError(
      "DOCUMENT_UNREADABLE",
      "The document cannot be read as UTF-8",
      422,
    );
  }
}
export function pathInsideFolder(
  root: string,
  folder: string,
  path: unknown,
): string {
  const text = validateText(path, "Path", 1000, true, true).replaceAll(
    "\\",
    "/",
  );
  const relative = posix.relative(folder, text);
  if (
    !relative ||
    relative.startsWith("../") ||
    relative === ".." ||
    posix.isAbsolute(relative) ||
    text.split("/").some((p) => p.startsWith(".")) ||
    /^(README|INSTRUCTION|SKILL|INDEX)\.md$/i.test(basename(text))
  )
    throw new ViewError(
      "ACCESS_DENIED",
      "Choose a person file in the bound folder",
      403,
    );
  checkedPath(root, text);
  if (!/\.md$/i.test(text))
    throw new ViewError("INVALID_INPUT", "Person records must be Markdown");
  return text;
}
export function scanFolder(
  root: string,
  folder: string,
): {
  people: PersonDocument[];
  files: ViewFile[];
  skipped: number;
  limited: boolean;
} {
  requireFolder(root, folder);
  const people: PersonDocument[] = [];
  const files: ViewFile[] = [];
  let skipped = 0;
  let limited = false;
  let totalBytes = 0;
  let entries = 0;
  function walk(relative: string, depth: number) {
    if (depth > 4) {
      limited = true;
      return;
    }
    for (const entry of readdirSync(checkedPath(root, relative), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entries > 1500 || files.length >= 500) {
        limited = true;
        return;
      }
      if (entry.name.startsWith(".")) continue;
      const path = posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) {
        skipped++;
        continue;
      }
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !/\.(md|csv|txt|json)$/i.test(entry.name))
        continue;
      let size: number;
      try {
        size = statSync(checkedPath(root, path)).size;
      } catch {
        skipped++;
        continue;
      }
      const row: ViewFile = { path, name: entry.name, size };
      files.push(row);
      if (
        !/\.md$/i.test(entry.name) ||
        /^(README|INSTRUCTION|SKILL|INDEX)\.md$/i.test(entry.name)
      )
        continue;
      if (size > MAX_DOCUMENT_BYTES || totalBytes + size > 8 * 1024 * 1024) {
        skipped++;
        limited = true;
        continue;
      }
      totalBytes += size;
      try {
        const content = readDocument(root, path);
        if (isPersonDocument(content, path)) {
          const p = parsePerson(content, path);
          if (people.some((existing) => existing.id === p.id)) {
            skipped++;
            continue;
          }
          people.push(p);
          row.personId = p.id;
        }
      } catch (e) {
        if (e instanceof ViewError) {
          skipped++;
          continue;
        }
        throw e;
      }
    }
  }
  try {
    walk(folder, 0);
  } catch (e) {
    if (e instanceof ViewError) throw e;
    throw new ViewError("ACCESS_DENIED", "The folder cannot be listed", 403);
  }
  return { people, files, skipped, limited };
}
export function summary(person: PersonDocument): PersonSummary {
  return {
    id: person.id,
    name: person.name,
    path: person.path,
    revision: person.revision,
    background: person.background.slice(0, 160),
    focus: person.focus.slice(0, 200),
    followup: person.followup,
    interactionCount: person.interactionCount,
  };
}
