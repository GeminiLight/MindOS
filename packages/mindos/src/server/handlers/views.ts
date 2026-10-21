import { WorkViewsService } from "../../knowledge/views/service.js";
import { randomUUID } from "node:crypto";
import { ViewsStore } from "../../knowledge/views/store.js";
import { ViewError } from "../../knowledge/views/types.js";
import {
  exportPeopleCsv,
  personMaterials,
  validateText,
} from "../../knowledge/views/markdown.js";
import { mindRootIdentity } from "../root-identity.js";
import { json, type MindosServerResponse } from "../response.js";
import type { MindosHttpServices } from "../services.js";
import { handleFilePost } from "./file.js";
import { recordKnowledgeWrite } from "../routes/files.js";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function viewsError(error: unknown): MindosServerResponse<unknown> {
  if (error instanceof ViewError)
    return json(
      { error: error.code, message: error.message },
      { status: error.status, headers },
    );
  const code = (error as NodeJS.ErrnoException)?.code;
  return json(
    {
      error:
        code === "EACCES" || code === "EPERM"
          ? "ACCESS_DENIED"
          : "VIEWS_UNAVAILABLE",
      message:
        "Views could not be read or saved. The original data was preserved.",
    },
    { status: code === "EACCES" || code === "EPERM" ? 403 : 500, headers },
  );
}
export function createViewsStore(
  services: MindosHttpServices,
  requestHeaders = new Headers(),
  signal?: AbortSignal,
): ViewsStore {
  const root = services.mindRoot;
  const rootId = mindRootIdentity(root);
  const agent = requestHeaders
    .get("x-mindos-agent")
    // eslint-disable-next-line no-control-regex
    ?.replace(/[\x00-\x1f]/g, "")
    .slice(0, 100);
  return new ViewsStore(root, async (operation) => {
    if (signal?.aborted)
      throw new ViewError(
        "REQUEST_CANCELLED",
        "The request was cancelled",
        499,
      );
    const result = await handleFilePost(
      { ...operation, expectedRootId: rootId },
      { mindRoot: root },
      {
        sourceHeader: requestHeaders.get("x-mindos-source"),
        agentHeader: agent,
        protectedRootFiles: services.knowledgeWrites?.protectedRootFiles,
      },
    );
    recordKnowledgeWrite(services, result, agent);
    if (result.status >= 400) {
      const value = result.body as { error?: string };
      throw new ViewError(
        result.status === 409
          ? "REVISION_CONFLICT"
          : result.status === 403
            ? "ACCESS_DENIED"
            : "WRITE_FAILED",
        value.error || "The original document could not be saved",
        result.status,
      );
    }
  });
}
export function handleViewsGet(
  query: URLSearchParams,
  services: MindosHttpServices,
): MindosServerResponse<unknown> {
  try {
    const root = services.mindRoot;
    const rootId = mindRootIdentity(root);
    if (query.has("rootId") && query.get("rootId") !== rootId)
      throw new ViewError("ROOT_CHANGED", "The knowledge library changed", 409);
    const store = createViewsStore(services);
    const op = query.get("op") || "list";
    const id = query.get("id") || "";
    if (op === "list")
      return json(
        {
          rootId,
          views: store.list(),
          folders: services
            .listDirectories()
            .filter(
              (p) =>
                p !== "." && !p.split("/").some((part) => part.startsWith(".")),
            )
            .slice(0, 1000),
        },
        { headers },
      );
    if (op === "preview")
      return json(
        { rootId, ...store.preview(query.get("folder")) },
        { headers },
      );
    if (op === "read") return json({ rootId, ...store.read(id) }, { headers });
    if (op === "raw")
      return json(
        { rootId, ...store.raw(id, query.get("path") || "") },
        { headers },
      );
    if (op === "person")
      return json(
        {
          rootId,
          person: store.person(
            id,
            query.get("personId") || "",
            query.get("path") || undefined,
          ),
        },
        { headers },
      );
    if (op === "csv") {
      const data = store.read(id);
      if (data.limited || data.skipped)
        throw new ViewError(
          "VIEW_LIMIT",
          "Narrow the folder before exporting a complete list",
          409,
        );
      const people = data.people.map((p) => store.person(id, p.id, p.path));
      return {
        status: 200,
        body: Buffer.from(exportPeopleCsv(people)),
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="people.csv"',
        },
      };
    }
    if (op === "prepare") {
      const p = store.person(
        id,
        query.get("personId") || "",
        query.get("path") || undefined,
      );
      if (query.get("expectedRevision") !== p.revision)
        throw new ViewError(
          "REVISION_CONFLICT",
          "The person file changed. Reload it before preparing materials",
          409,
        );
      const selected = (query.get("selected") || "").split(",");
      const items = personMaterials(p, selected);
      if (!items.length)
        throw new ViewError("NO_MATERIALS", "Choose at least one item");
      const target = validateText(
        query.get("target") || "Agent",
        "Target",
        80,
        true,
        true,
      );
      const text =
        (query.get("locale") === "en"
          ? `Task: Prepare for a meeting\nFor: ${target}\nUse the selected information below. Identify talking points, open commitments and questions; do not invent facts.\n\n`
          : `任务：会前准备\n准备给：${target}\n请根据以下选定资料整理沟通重点、未完成跟进和待核对的问题，不补造人物事实。\n\n`) +
        items
          .map(
            (item) => `## ${item.label}\n来源：${item.path}\n\n${item.content}`,
          )
          .join("\n\n---\n\n");
      return json({ rootId, revision: p.revision, items, text }, { headers });
    }
    throw new ViewError("INVALID_INPUT", "Unknown view operation");
  } catch (error) {
    return viewsError(error);
  }
}
export async function handleViewsPost(
  body: unknown,
  services: MindosHttpServices,
  requestHeaders = new Headers(),
  signal?: AbortSignal,
): Promise<MindosServerResponse<unknown>> {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ViewError("INVALID_INPUT", "A valid request is required");
    const input = body as Record<string, unknown>;
    const rootId = mindRootIdentity(services.mindRoot);
    if (input.expectedRootId !== rootId)
      throw new ViewError("ROOT_CHANGED", "The knowledge library changed", 409);
    if (signal?.aborted)
      throw new ViewError("REQUEST_CANCELLED", "Request cancelled", 499);
    const store = createViewsStore(services, requestHeaders, signal);
    const id = typeof input.id === "string" ? input.id : "";
    const personId = typeof input.personId === "string" ? input.personId : "";
    if (input.op === "create")
      return json({ rootId, view: await store.create(input) }, { headers });
    if (input.op === "rename")
      return json(
        {
          rootId,
          view: await store.rename(id, input.name, input.expectedVersion),
        },
        { headers },
      );
    if (input.op === "rebind")
      return json(
        {
          rootId,
          view: await store.rebind(id, input.folder, input.expectedVersion),
        },
        { headers },
      );
    if (input.op === "remove") {
      await store.remove(id, input.expectedVersion);
      return json({ rootId, ok: true }, { headers });
    }
    if (input.op === "remember")
      return json(
        {
          rootId,
          view: await store.remember(
            id,
            personId,
            typeof input.path === "string" ? input.path : undefined,
          ),
        },
        { headers },
      );
    if (
      [
        "person.create",
        "person.update",
        "interaction.add",
        "followup.update",
      ].includes(String(input.op))
    ) {
      const service = new WorkViewsService(services.mindRoot, store.write);
      const view = service.list().views.find((v) => v.id === id);
      if (!view || view.template !== "people")
        throw new ViewError("VIEW_MISSING", "Choose a people view", 404);
      const snapshot = service.read(view.collectionId!);
      const action =
        input.op === "person.create"
          ? "record.create"
          : input.op === "person.update"
            ? "record.update"
            : String(input.op);
      const operationId =
        typeof input.operationId === "string"
          ? input.operationId
          : randomUUID();
      await service.mutate({
        collectionId: view.collectionId,
        action,
        operationId,
        recordId: personId || undefined,
        expectedRevision: action === "record.create" && input.expectedRevision === "" ? undefined : input.expectedRevision,
        expectedSchemaRevision: snapshot.schemaRevision,
        input: action.startsWith("record.")
          ? input.fields
          : {
              text: input.text,
              date: input.date,
              ...(action === "interaction.add"
                ? { source: input.source ?? "" }
                : { completed: input.completed }),
            },
      });
      return json(
        { rootId, person: store.person(id, personId || "p-" + operationId) },
        { headers },
      );
    }
    throw new ViewError("INVALID_INPUT", "Unknown view operation");
  } catch (error) {
    return viewsError(error);
  }
}
