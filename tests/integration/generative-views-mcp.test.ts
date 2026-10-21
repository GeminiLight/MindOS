import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const requireProduct = createRequire(resolve("packages/mindos/package.json"));
it.skipIf(process.env.MINDOS_VIEWS_ISOLATED !== "1")(
  "two MCP clients continue the same records across reconnects",
  async () => {
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
            MINDOS_VIEWS_CLI: process.env.MINDOS_VIEWS_CLI ?? resolve("packages/mindos/bin/cli.js"),
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
    } finally {
      for (const c of clients) await c.close();
    }
  },
  60000,
);
