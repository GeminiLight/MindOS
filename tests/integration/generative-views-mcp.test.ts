import { viewsFixtureIdentity } from "../helpers/views-fixture.mjs";
import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const requireProduct = createRequire(resolve("packages/mindos/package.json"));
it.skipIf(process.env.MINDOS_VIEWS_ISOLATED !== "1")(
  "two MCP clients continue the same records across reconnects",
  async () => {
    const expectedFixtureRoot = viewsFixtureIdentity();
    const { Client } = await import(
      pathToFileURL(
        requireProduct.resolve("@modelcontextprotocol/sdk/client/index.js"),
      ).href
    );
    const { StdioClientTransport } = await import(
      pathToFileURL(
        requireProduct.resolve("@modelcontextprotocol/sdk/client/stdio.js"),
      ).href
    );
    const clients: any[] = [];
    const connect = async (name: string) => {
      const client = new Client({ name, version: "1.0.0" });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve("plugins/mindos/scripts/mcp.mjs")],
        env: Object.fromEntries(
          Object.entries({
            ...process.env,
            MINDOS_URL: process.env.MINDOS_URL,
            MINDOS_VIEWS_CLI:
              process.env.MINDOS_VIEWS_CLI ??
              resolve("packages/mindos/bin/cli.js"),
            HOME: process.env.MINDOS_TEST_HOME,
          }).filter(([, v]) => typeof v === "string"),
        ),
        stderr: "pipe",
      });
      await client.connect(transport);
      clients.push(client);
      return client;
    };
    const call = async (client: any, name: string, args: any = {}) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    };
    try {
      const codex = await connect("codex"),
        claude = await connect("claude-code");
      const info = await call(codex, "mindos_views_describe");
      expect(info.rootId).toBe(expectedFixtureRoot);
      expect((await call(claude, "mindos_views_describe")).rootId).toBe(
        info.rootId,
      );
      const create = {
        name: "Host continuity",
        folder: "验证/宿主-" + randomUUID(),
        mode: "new",
        template: "tasks",
        operationId: randomUUID(),
        expectedRootId: info.rootId,
      };
      const c = await call(codex, "mindos_views_create", create),
        data = await call(codex, "mindos_views_read", {
          collectionId: c.collection.id,
        });
      const request = {
        expectedRootId: info.rootId,
        collectionId: c.collection.id,
        action: "record.create",
        operationId: randomUUID(),
        expectedRevision: data.revision,
        expectedSchemaRevision: data.schemaRevision,
        input: { title: "Codex created", status: "todo" },
      };
      await call(codex, "mindos_views_mutate", request);
      await call(claude, "mindos_views_mutate", request);
      const next = await call(claude, "mindos_views_read", {
        collectionId: c.collection.id,
      });
      expect(next.records).toHaveLength(1);
      await call(claude, "mindos_views_mutate", {
        ...request,
        operationId: randomUUID(),
        action: "record.update",
        recordId: next.records[0].id,
        expectedRevision: next.revision,
        input: { status: "done" },
      });
      await codex.close();
      const reopened = await connect("codex");
      expect(
        (
          await call(reopened, "mindos_views_read", {
            collectionId: c.collection.id,
          })
        ).records[0].fields.status,
      ).toBe("done");
      const preview = await call(reopened, "mindos_views_preview", {
        expectedRootId: info.rootId,
        collectionId: c.collection.id,
        spec: { ...c.view.spec, layout: "board", groupBy: "status" },
      });
      expect(
        (
          await call(claude, "mindos_views_save", {
            expectedRootId: info.rootId,
            operationId: randomUUID(),
            draftId: preview.draftId,
            name: "Across hosts",
          })
        ).committed,
      ).toBe(true);
      const pageSpec = {
        specVersion: 1,
        title: "Shared project page",
        layout: { columns: 2, density: "comfortable" },
        blocks: [
          {
            id: "tasks",
            title: "Project tasks",
            kind: "tasks",
            collectionId: c.collection.id,
          },
          {
            id: "intro",
            title: "Overview",
            kind: "html",
            html: "<p>Our work</p>",
          },
        ],
      };
      const projectId = "project-" + randomUUID();
      const contacts = await call(reopened, "mindos_views_create", {
        expectedRootId: info.rootId,
        operationId: randomUUID(),
        template: "people",
        name: "Project collaborators",
        folder: "MCP-People-" + randomUUID(),
        mode: "new",
      });
      const peopleSnapshot = await call(claude, "mindos_views_read", {
        collectionId: contacts.collection.id,
      });
      await call(claude, "mindos_views_mutate", {
        expectedRootId: info.rootId,
        operationId: randomUUID(),
        collectionId: contacts.collection.id,
        action: "record.create",
        expectedSchemaRevision: peopleSnapshot.schemaRevision,
        input: { name: "MCP colleague" },
      });
      const personSnapshot = await call(reopened, "mindos_views_read", {
        collectionId: contacts.collection.id,
      });
      const person = personSnapshot.records[0],
        personRef = contacts.collection.id + "/" + person.id;
      const projectSave = {
        action: "save",
        expectedRootId: info.rootId,
        expectedVersion: 0,
        operationId: randomUUID(),
        project: {
          id: projectId,
          title: "Shared Studio project",
          goal: "Continue across clients",
          taskCollectionIds: [c.collection.id],
          personRefs: [personRef],
        },
      };
      await call(reopened, "mindos_projects_write", projectSave);
      expect(
        (await call(claude, "mindos_projects_read", { projectId })).project
          .title,
      ).toBe("Shared Studio project");
      const communication = {
        action: "conversation",
        expectedRootId: info.rootId,
        projectId,
        personRef,
        expectedVersion: 1,
        expectedRevision: person.source.revision,
        expectedSchemaRevision: personSnapshot.schemaRevision,
        operationId: randomUUID(),
        text: "Confirmed across agent clients",
        date: "2026-10-23",
      };
      await call(claude, "mindos_projects_write", communication);
      await call(reopened, "mindos_projects_write", communication);
      expect(
        (await call(reopened, "mindos_projects_read", { projectId })).activity,
      ).toHaveLength(1);
      const projectPage = await call(claude, "mindos_projects_write", {
        action: "open-page",
        expectedRootId: info.rootId,
        projectId,
      });
      expect(
        (
          await call(reopened, "mindos_projects_write", {
            action: "open-page",
            expectedRootId: info.rootId,
            projectId,
          })
        ).page.id,
      ).toBe(projectPage.page.id);
      const pagePreview = await call(reopened, "mindos_pages_preview", {
        expectedRootId: info.rootId,
        spec: pageSpec,
      });
      expect(pagePreview.blocks[0].data.records[0].fields.status).toBe("done");
      const pageSave = {
        expectedRootId: info.rootId,
        operationId: randomUUID(),
        expectedVersion: 0,
        spec: pageSpec,
      };
      const savedPage = await call(reopened, "mindos_pages_save", pageSave);
      expect((await call(claude, "mindos_pages_save", pageSave)).page.id).toBe(
        savedPage.page.id,
      );
      const readPage = await call(claude, "mindos_pages_read", {
        rootId: info.rootId,
        pageId: savedPage.page.id,
      });
      expect(readPage.page.spec.title).toBe(pageSpec.title);
      await call(claude, "mindos_pages_save", {
        ...pageSave,
        operationId: randomUUID(),
        pageId: savedPage.page.id,
        expectedVersion: 1,
        spec: { ...pageSpec, title: "Revised from Claude" },
      });
      const restored = await call(reopened, "mindos_pages_save", {
        action: "restore",
        expectedRootId: info.rootId,
        operationId: randomUUID(),
        pageId: savedPage.page.id,
        expectedVersion: 2,
        restoreVersion: 1,
      });
      expect(restored.page.spec.title).toBe(pageSpec.title);
      await call(claude, "mindos_pages_save", {
        action: "remove",
        expectedRootId: info.rootId,
        operationId: randomUUID(),
        pageId: savedPage.page.id,
        expectedVersion: 3,
      });
      expect(
        (
          await call(claude, "mindos_views_read", {
            collectionId: c.collection.id,
          })
        ).records[0].fields.status,
      ).toBe("done");
    } finally {
      for (const c of clients) await c.close();
    }
  },
  60000,
);
