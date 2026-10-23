import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { checkedPath } from "./paths.js";
import { atomicMetadata } from "./operations.js";
import { ViewError } from "./types.js";
import { projectIdentity } from "./project-identity.js";

export const PROJECTS_PATH = ".mindos/views/projects.json";
const collection = z.string().regex(/^c-[a-z0-9-]{8,80}$/);
export const projectDefinition = z.strictObject({
  id: projectIdentity,
  title: z.string().trim().min(1).max(100),
  goal: z.string().trim().max(2000),
  taskCollectionIds: z.array(collection).max(4),
  personRefs: z
    .array(z.string().regex(/^c-[a-z0-9-]{8,80}\/p-[a-z0-9-]{8,80}$/))
    .max(40),
});
const version = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const savedProject = projectDefinition.extend({
  version,
  updatedAt: z.string().datetime(),
  pageGeneration: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1)
    .default(0),
});
const receipt = z.strictObject({
  operationId: z.string().uuid(),
  fingerprint: z.string().length(64),
  projectId: projectIdentity,
});
const registry = z.strictObject({
  schemaVersion: z.literal(1),
  projects: z.array(savedProject).max(100),
  operations: z.array(receipt).max(500),
});
export type WorkProject = z.infer<typeof savedProject>;
export type ProjectDefinition = z.infer<typeof projectDefinition>;
export type ProjectRegistry = z.infer<typeof registry>;

export function assertProjectPath(root: string) {
  for (const path of [".mindos", ".mindos/views", PROJECTS_PATH]) {
    try {
      if (lstatSync(join(root, path)).isSymbolicLink())
        throw new ViewError(
          "ACCESS_DENIED",
          "Project metadata cannot use symbolic links",
          403,
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export function readProjects(root: string): ProjectRegistry {
  assertProjectPath(root);
  const path = checkedPath(root, PROJECTS_PATH);
  if (!existsSync(path))
    return { schemaVersion: 1, projects: [], operations: [] };
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error();
    const parsed = registry.parse(JSON.parse(readFileSync(path, "utf8")));
    const ids = parsed.projects.map((p) => p.id),
      owned = parsed.projects.flatMap((p) => p.taskCollectionIds);
    if (
      new Set(ids).size !== ids.length ||
      new Set(owned).size !== owned.length
    )
      throw new Error();
    for (const p of parsed.projects)
      if (
        new Set(p.personRefs).size !== p.personRefs.length ||
        new Set(p.personRefs.map((r) => r.split("/")[0])).size > 4
      )
        throw new Error();
    return parsed;
  } catch {
    throw new ViewError(
      "PROJECTS_UNREADABLE",
      "Project relationships could not be read. The original metadata was preserved.",
      500,
    );
  }
}
export function findProject(root: string, id: unknown): WorkProject {
  const parsed = projectIdentity.safeParse(id);
  if (!parsed.success)
    throw new ViewError("INVALID_PROJECT", "Choose a valid project identity");
  const p = readProjects(root).projects.find((p) => p.id === id);
  if (!p)
    throw new ViewError(
      "PROJECT_MISSING",
      "This project has not been connected to this library",
      404,
    );
  return p;
}
export function writeProjects(root: string, value: ProjectRegistry) {
  assertProjectPath(root);
  registry.parse(value);
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
    throw new ViewError(
      "PROJECTS_CAPACITY",
      "Project metadata reached its storage limit",
      413,
    );
  atomicMetadata(root, PROJECTS_PATH, value);
}
