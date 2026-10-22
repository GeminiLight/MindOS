import { existsSync, lstatSync, readFileSync } from "node:fs";
import { z } from "zod";
import { join } from "node:path";
import { checkedPath } from "./paths.js";
import { atomicMetadata } from "./operations.js";
import { ViewError } from "./types.js";
import {
  pageSpecSchema,
  validatePageSpec,
  type PageSpec,
} from "./page-spec.js";
export const PAGES_PATH = ".mindos/views/pages.json";
export const MAX_PAGES_BYTES = 16 * 1024 * 1024;
export const MAX_RETIRED_PAGES = 100000;
export type PageVersion = {
  version: number;
  spec: PageSpec;
  createdAt: string;
};
export type SavedPage = {
  id: string;
  spec: PageSpec;
  version: number;
  createdAt: string;
  updatedAt: string;
  history: PageVersion[];
};
type PageReceipt = {
  operationId: string;
  fingerprint: string;
  pageId: string;
  removed?: boolean;
};
export type PageRegistry = {
  schemaVersion: 1;
  pages: SavedPage[];
  operations: PageReceipt[];
  retiredPageIds: string[];
};
const date = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const version = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const identity = z.string().regex(/^[a-z][a-z0-9-]{7,79}$/);
const savedPageSchema = z.strictObject({
  id: identity,
  spec: pageSpecSchema,
  version,
  createdAt: date,
  updatedAt: date,
  history: z
    .array(z.strictObject({ version, spec: pageSpecSchema, createdAt: date }))
    .max(20),
});
const registrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  pages: z.array(savedPageSchema).max(100),
  retiredPageIds: z.array(identity).max(MAX_RETIRED_PAGES).default([]),
  operations: z
    .array(
      z.strictObject({
        operationId: z
          .string()
          .regex(
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
          ),
        fingerprint: z.string().length(64),
        pageId: identity,
        removed: z.boolean().optional(),
      }),
    )
    .max(500),
});
export function assertPageMetadataPath(root: string): void {
  // Internal metadata must never be redirected into a source folder, even inside the library.
  for (const part of [".mindos", ".mindos/views", PAGES_PATH]) {
    try {
      if (lstatSync(join(root, part)).isSymbolicLink())
        throw new ViewError(
          "ACCESS_DENIED",
          "Page metadata cannot use symbolic links",
          403,
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export function readPages(root: string): PageRegistry {
  assertPageMetadataPath(root);
  const file = checkedPath(root, PAGES_PATH);
  if (!existsSync(file))
    return { schemaVersion: 1, pages: [], operations: [], retiredPageIds: [] };
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_PAGES_BYTES) throw new Error();
    const registry = registrySchema.parse(
      JSON.parse(readFileSync(file, "utf8")),
    );
    if (
      new Set(registry.pages.map((page) => page.id)).size !==
      registry.pages.length
    )
      throw new Error();
    for (const page of registry.pages) {
      validatePageSpec(page.spec);
      if (
        new Set(page.history.map((v) => v.version)).size !==
          page.history.length ||
        page.history.some((v) => v.version >= page.version)
      )
        throw new Error();
      for (const item of page.history) validatePageSpec(item.spec);
    }
    return registry;
  } catch {
    throw new ViewError(
      "PAGES_UNREADABLE",
      "Saved pages could not be read. The original metadata was preserved.",
      500,
    );
  }
}
export function writePages(root: string, registry: PageRegistry): void {
  assertPageMetadataPath(root);
  const raw = JSON.stringify(registry);
  if (Buffer.byteLength(raw) > MAX_PAGES_BYTES)
    throw new ViewError(
      "PAGES_CAPACITY",
      "Saved pages reached the storage limit. Remove unused pages before saving.",
      413,
    );
  atomicMetadata(root, PAGES_PATH, registry);
}
