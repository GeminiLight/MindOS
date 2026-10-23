import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ViewsClient,
  ViewsClientError,
} from "../../foundation/views-client.js";
export function registerViewsTools(
  server: McpServer,
  baseUrl: string,
  token?: string,
) {
  const call = (op: string) => async (input: Record<string, unknown>) => {
    try {
      const client = new ViewsClient({
        baseUrl,
        token,
        agentName: server.server.getClientVersion()?.name,
      });
      const result = await client.request(op, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (e) {
      const result = {
        error: e instanceof ViewsClientError ? e.code : "VIEWS_UNAVAILABLE",
        message: e instanceof Error ? e.message : String(e),
      };
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
  };
  const root = z.string(),
    operationId = z.string().uuid(),
    collectionId = z.string();
  server.registerTool(
    "mindos_projects_read",
    {
      description:
        "List durable Studio project relationships, or read one project, linked people and bounded project communication. Read version before changes; names are not identities.",
      inputSchema: z.object({
        rootId: root.optional(),
        projectId: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => call(input.projectId ? "project.read" : "project.list")(input),
  );
  server.registerTool(
    "mindos_projects_write",
    {
      description:
        "Save explicitly authorized project relationships, open its one stable work page, or record communication in a linked person original Markdown. Save requires project:{id,title,goal,taskCollectionIds,personRefs}, expectedVersion and operationId. Conversation requires projectId, personRef, text, date, expectedVersion and original person revisions. Never infer links from matching names.",
      inputSchema: z.object({
        action: z.enum(["save", "open-page", "conversation"]),
        expectedRootId: root,
        projectId: z.string().optional(),
        project: z.record(z.string(), z.unknown()).optional(),
        expectedVersion: z.number().int().min(0).optional(),
        operationId: operationId.optional(),
        personRef: z.string().optional(),
        text: z.string().optional(),
        date: z.string().optional(),
        source: z.string().optional(),
        expectedRevision: z.string().optional(),
        expectedSchemaRevision: z.string().optional(),
      }),
    },
    ({ action, ...input }) =>
      call(
        action === "save"
          ? "project.save"
          : action === "open-page"
            ? "project.page"
            : "project.interact",
      )(input),
  );
  server.registerTool(
    "mindos_views_describe",
    {
      description:
        "Discover local view capabilities, templates, fields, mutationInputs (exact write keys/examples) and schema revisions before editing or generating a view.",
      inputSchema: z.object({ collectionId: collectionId.optional() }),
      annotations: { readOnlyHint: true },
    },
    call("describe"),
  );
  server.registerTool(
    "mindos_views_read",
    {
      description:
        "Read shared records, views or an operation receipt. Re-read revisions before editing.",
      inputSchema: z.object({
        collectionId: collectionId.optional(),
        viewId: z.string().optional(),
        rootId: root.optional(),
        operationId: z.string().optional(),
        recordId: z.string().optional(),
        fields: z.array(z.string()).min(1).max(20).optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      call(
        input.operationId
          ? "operation"
          : input.collectionId || input.viewId
            ? "read"
            : "list",
      )({ ...input, limit: input.limit ?? 20 }),
  );
  server.registerTool(
    "mindos_views_create",
    {
      description:
        "Create an empty people/task collection or bind existing compatible files. Never migrate arbitrary CSV automatically.",
      inputSchema: z.object({
        expectedRootId: root,
        operationId,
        name: z.string(),
        folder: z.string(),
        template: z.enum(["people", "tasks"]),
        mode: z.enum(["new", "existing"]),
      }),
    },
    call("create"),
  );
  server.registerTool(
    "mindos_views_mutate",
    {
      description:
        "Update one local record with version guards. Retry the identical operationId after timeouts. schema.extend supports optional x_* text fields only.",
      inputSchema: z.object({
        expectedRootId: root,
        operationId,
        collectionId,
        projectId: z.string().optional(),
        expectedProjectVersion: z.number().int().min(1).optional(),
        action: z.enum([
          "record.create",
          "record.update",
          "interaction.add",
          "followup.update",
          "schema.extend",
          "operation.undo",
        ]),
        recordId: z.string().optional(),
        expectedRevision: z.string().optional(),
        expectedSchemaRevision: z.string().optional(),
        input: z
          .record(z.string(), z.unknown())
          .describe(
            "Follow describe.mutationInputs for the selected action/template. interaction.add: {text,date,source?}; followup.update: {text,date,completed:boolean}; task personRef is the string collectionId/personId, not an object. Read fields such as followup are not write keys.",
          ),
      }),
    },
    call("mutate"),
  );
  server.registerTool(
    "mindos_views_preview",
    {
      description:
        "Validate a declarative ViewSpec and open a 30-minute local preview. No scripts, React or arbitrary code.",
      inputSchema: z.object({
        expectedRootId: root,
        collectionId,
        spec: z.record(z.string(), z.unknown()).optional(),
        schemaExtension: z.object({ key: z.string() }).optional(),
      }),
    },
    call("preview"),
  );
  server.registerTool(
    "mindos_views_save",
    {
      description:
        "Save an authorized preview, rename/copy/pin/restore a view, or remove its entry while retaining data.",
      inputSchema: z.object({
        expectedRootId: root,
        operationId,
        action: z.enum(["save", "copy", "remove", "restore"]).optional(),
        draftId: z.string().optional(),
        viewId: z.string().optional(),
        expectedViewVersion: z.number().int().optional(),
        name: z.string().optional(),
        pinned: z.boolean().optional(),
      }),
    },
    call("save"),
  );
  server.registerTool(
    "mindos_pages_read",
    {
      description:
        "List saved work pages, or read one page and its bounded live data. A page combines multiple sources without copying records. Read version before editing.",
      inputSchema: z.object({
        rootId: root.optional(),
        pageId: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => call(input.pageId ? "page.read" : "page.list")(input),
  );
  server.registerTool(
    "mindos_pages_preview",
    {
      description:
        "Validate and preview a multi-source PageSpec v1 without saving or adding navigation. Read describe.pages first. Support tasks/people/notes/summary/html blocks, locked blocks and isolated custom web content. Never change locked blocks without user direction.",
      inputSchema: z.object({
        expectedRootId: root,
        spec: z.record(z.string(), z.unknown()),
      }),
      annotations: { readOnlyHint: true },
    },
    call("page.preview"),
  );
  server.registerTool(
    "mindos_pages_save",
    {
      description:
        "Save a page specification, restore a saved page version, or remove the page entry while preserving all source records. Save requires expectedVersion=0 for a new page; edits/restores/removal require the current version. Preview before saving. Retry an identical operationId after an uncertain response.",
      inputSchema: z.object({
        expectedRootId: root,
        operationId,
        action: z.enum(["save", "restore", "remove"]).default("save"),
        pageId: z.string().optional(),
        expectedVersion: z.number().int().min(0),
        restoreVersion: z.number().int().min(1).optional(),
        spec: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    ({ action, ...input }) => call("page." + action)(input),
  );
}
