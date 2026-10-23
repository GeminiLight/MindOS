import { z } from "zod";
import { ViewError } from "./types.js";
import { viewSpecSchema } from "./view-spec.js";
import { projectIdentity } from "./project-identity.js";

export const MAX_PAGE_BYTES = 128 * 1024;
const text = (max: number) => z.string().trim().min(1).max(max);
const collectionId = z.string().regex(/^c-[a-z0-9-]{8,80}$/);
const viewId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{7,100}$/);
const relativePath = text(500).refine(
  (path) =>
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes(":") &&
    path.split("/").every((part) => part.length > 0 && !part.startsWith(".")),
  "Choose a visible path inside the knowledge library",
);
export const pageBlockSchema = z
  .strictObject({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    title: text(100),
    kind: z.enum(["tasks", "people", "notes", "summary", "html"]),
    collectionId: collectionId.optional(),
    viewId: viewId.optional(),
    fields: z.array(text(80)).min(1).max(20).optional(),
    filter: viewSpecSchema.shape.filter,
    html: z
      .string()
      .min(1)
      .max(96 * 1024)
      .optional(),
    folder: relativePath.optional(),
    paths: z.array(relativePath).min(1).max(10).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    locked: z.boolean().optional(),
    layout: z.enum(["list-detail", "table", "board"]).optional(),
  })
  .superRefine((block, ctx) => {
    if (
      ["tasks", "people", "summary"].includes(block.kind) &&
      !block.collectionId &&
      !block.viewId
    )
      ctx.addIssue({
        code: "custom",
        message: "Bind this block to a collection or saved view",
        path: ["collectionId"],
      });
    if (block.kind === "notes" && !block.folder && !block.paths)
      ctx.addIssue({
        code: "custom",
        message: "Choose note paths or a folder",
        path: ["folder"],
      });
    if (block.kind === "notes" && block.folder && block.paths)
      ctx.addIssue({
        code: "custom",
        message: "Choose note paths or a folder, not both",
        path: ["paths"],
      });
    if (block.kind === "html" && !block.html?.trim())
      ctx.addIssue({
        code: "custom",
        message: "Provide the custom page HTML",
        path: ["html"],
      });
    if (block.kind !== "html" && block.html !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "Only custom web blocks may contain HTML",
        path: ["html"],
      });
  });
export const pageSpecSchema = z
  .strictObject({
    specVersion: z.literal(1),
    projectId: projectIdentity.optional(),
    projectSources: z.array(collectionId).max(8).optional(),
    title: text(100),
    description: z.string().max(500).optional(),
    layout: z.strictObject({
      columns: z.union([z.literal(1), z.literal(2)]),
      density: z.enum(["comfortable", "compact"]),
    }),
    blocks: z.array(pageBlockSchema).min(1).max(12),
  })
  .superRefine((page, ctx) => {
    if (
      new Set(page.blocks.map((block) => block.id)).size !== page.blocks.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Each block needs a unique ID",
        path: ["blocks"],
      });
  });
export type PageSpec = z.infer<typeof pageSpecSchema>;
export type PageBlock = z.infer<typeof pageBlockSchema>;
export function validatePageSpec(input: unknown): PageSpec {
  let raw: string;
  try {
    raw = JSON.stringify(input) ?? "";
  } catch {
    throw new ViewError("INVALID_PAGE", "The page must be JSON");
  }
  if (Buffer.byteLength(raw) > MAX_PAGE_BYTES)
    throw new ViewError("INVALID_PAGE", "The page exceeds 128 KiB", 413);
  const parsed = pageSpecSchema.safeParse(input);
  if (!parsed.success)
    throw new ViewError(
      "INVALID_PAGE",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  return parsed.data;
}
