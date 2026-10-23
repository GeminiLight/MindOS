import {
  generatePage,
  type PageGenerationModel,
} from "../../knowledge/views/page-generation.js";
import { WorkPagesService } from "../../knowledge/views/page-service.js";
import { readRegistry } from "../../knowledge/views/registry.js";
import { PEOPLE_FIELDS, TASK_FIELDS } from "../../knowledge/views/view-spec.js";
import { inputObject } from "../../knowledge/views/service.js";
import { ViewError } from "../../knowledge/views/types.js";
import { mindRootIdentity } from "../root-identity.js";
import type { MindosHttpServices } from "../services.js";
import { json } from "../response.js";
import { viewsError } from "./views.js";
import { createPageModel } from "./views-page-model.js";
import { findProject } from "../../knowledge/views/project-store.js";
const active = new Map<string, number>();
export async function handlePageGenerate(
  body: unknown,
  services: MindosHttpServices,
  signal?: AbortSignal,
  model?: PageGenerationModel,
) {
  let rootId: string | undefined,
    acquired = false;
  try {
    const input = inputObject(body);
    rootId = mindRootIdentity(services.mindRoot);
    if (input.expectedRootId !== rootId)
      throw new ViewError(
        "ROOT_CHANGED",
        "Library changed; reopen this page.",
        409,
      );
    if ((active.get(rootId) ?? 0) >= 2)
      throw new ViewError(
        "AI_BUSY",
        "Two page adjustments are already running. Wait or cancel one.",
        429,
      );
    active.set(rootId, (active.get(rootId) ?? 0) + 1);
    acquired = true;
    const registry = readRegistry(services.mindRoot);
    const pageInput = inputObject(input.spec);
    const project = pageInput.projectId
      ? findProject(services.mindRoot, pageInput.projectId)
      : undefined;
    const sources = registry.collections
      .filter(
        (c) =>
          !project ||
          project.taskCollectionIds.includes(c.id) ||
          project.personRefs.some((ref) => ref.startsWith(c.id + "/")),
      )
      .slice(0, 50)
      .map((c) => ({
        collectionId: c.id,
        name:
          registry.views.find((v) => v.collectionId === c.id)?.name ?? c.folder,
        template: c.template,
        folder: c.folder,
        fields: {
          ...(c.template === "people" ? PEOPLE_FIELDS : TASK_FIELDS),
          ...Object.fromEntries(
            registry.views
              .filter((v) => v.collectionId === c.id)
              .flatMap((v) => v.spec?.fields ?? [])
              .filter((k) => k.startsWith("x_"))
              .map((k) => [k, "text"]),
          ),
        },
        views: registry.views
          .filter((v) => v.collectionId === c.id)
          .slice(0, 10)
          .map((v) => ({ id: v.id, name: v.name })),
      }));
    const timer = AbortSignal.timeout(90000);
    const combined = signal ? AbortSignal.any([signal, timer]) : timer;
    let result;
    try {
      result = await generatePage(
        {
          prompt: input.prompt,
          spec: input.spec,
          selectedBlockId: input.selectedBlockId,
        },
        sources,
        model ?? createPageModel(services.readSettings()),
        combined,
      );
    } catch (error) {
      if (combined.aborted)
        throw new ViewError(
          "AI_CANCELLED",
          signal?.aborted
            ? "Page adjustment cancelled. Your page is unchanged."
            : "Page adjustment timed out. Your page is unchanged; try a smaller change.",
          408,
        );
      throw error;
    }
    if (rootId !== mindRootIdentity(services.mindRoot))
      throw new ViewError(
        "ROOT_CHANGED",
        "Library changed; reopen this page.",
        409,
      );
    const preview = new WorkPagesService(services.mindRoot).preview({
      spec: result.spec,
      expectedRootId: rootId,
    });
    if (preview.blocks.some((block) => block.error))
      throw new ViewError(
        "AI_INVALID_PAGE",
        "The generated page contains an unavailable data source. Your page is unchanged; choose an existing source and retry.",
        422,
      );
    return json(
      { rootId, ...result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return viewsError(error);
  } finally {
    if (acquired && rootId) {
      const count = (active.get(rootId) ?? 1) - 1;
      if (count > 0) active.set(rootId, count);
      else active.delete(rootId);
    }
  }
}
