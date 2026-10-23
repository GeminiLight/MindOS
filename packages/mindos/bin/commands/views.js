import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { ViewsClient } from "../../dist/foundation/views-client.js";
export const meta = {
  name: "views",
  group: "Knowledge",
  summary: "Shared people, project tasks and generated views",
  usage:
    "mindos views <doctor|templates|list|describe|read|create|mutate|preview|save|operation|open|page.*|project.list|project.read|project.save|project.page|project.interact> [id] --input <file|->",
  flags: {
    "--input <file|->": "JSON input file or stdin",
    "--json": "JSON output (default)",
  },
  examples: [
    "mindos views doctor",
    "mindos views create --input create.json",
    "mindos views mutate --input -",
    "mindos views open v-12345678",
  ],
};
export function viewUrl(base, id) {
  if (id && !/^[vd]-[a-z0-9-]{8,80}$/.test(id))
    throw Error("Invalid view identity");
  const origin = new URL(base);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw Error("Invalid MindOS origin");
  return new URL(
    "/studio/views" +
      (id ? (id.startsWith("d-") ? "/preview/" : "/") + id : ""),
    origin.origin,
  ).href;
}
export function pageUrl(base, id) {
  if (id && !/^page-[a-z0-9-]{8,80}$/.test(id))
    throw Error("Invalid page identity");
  const origin = new URL(base);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw Error("Invalid MindOS origin");
  return new URL("/studio/pages" + (id ? "/" + id : ""), origin.origin).href;
}
export async function run(args, flags = {}) {
  loadConfig();
  const op = args[0] ?? "list",
    base =
      process.env.MINDOS_URL ??
      `http://localhost:${process.env.MINDOS_WEB_PORT ?? 3456}`;
  const client = new ViewsClient({
    baseUrl: base,
    token: process.env.MINDOS_AUTH_TOKEN ?? process.env.AUTH_TOKEN,
    agentName: "mindos-cli",
  });
  try {
    let input = {};
    if (flags.input) {
      const raw = readFileSync(flags.input === "-" ? 0 : flags.input, "utf8");
      if (Buffer.byteLength(raw) > 160000) throw Error("Input exceeds 160 KB");
      input = JSON.parse(raw);
      if (!input || Array.isArray(input) || typeof input !== "object")
        throw Error("Expected JSON object");
    }
    if (op === "open" || op === "page.open") {
      const capabilities = await client.request("describe");
      if (capabilities.capabilityVersion !== 1)
        throw Error("Runtime does not support views capability 1");
      const url =
        op === "page.open" ? pageUrl(base, args[1]) : viewUrl(base, args[1]);
      if (op === "page.open" && args[1])
        await client.request("page.read", { pageId: args[1] });
      if (op === "open" && args[1])
        await client.request(
          args[1].startsWith("d-") ? "preview" : "read",
          args[1].startsWith("d-") ? { draftId: args[1] } : { viewId: args[1] },
        );
      let opened = false;
      try {
        execFileSync(
          process.platform === "darwin" ? "open" : "xdg-open",
          [url],
          { stdio: "ignore", timeout: 5000 },
        );
        opened = true;
      } catch {
        /* Always return a usable URL. */
      }
      console.log(JSON.stringify({ url, opened }));
      return;
    }
    if (
      ![
        "doctor",
        "templates",
        "list",
        "describe",
        "read",
        "create",
        "mutate",
        "preview",
        "save",
        "operation",
        "page.list",
        "page.read",
        "page.data",
        "page.preview",
        "page.generate",
        "page.save",
        "page.restore",
        "page.remove",
        'project.list','project.read','project.save','project.page','project.interact',
      ].includes(op)
    )
      throw Error("Unknown views command");
    if(args[1]&&op.startsWith('project.')) input.projectId=args[1];
    else if (args[1])
      input[
        op.startsWith("page.")
          ? "pageId"
          : op === "operation"
            ? "operationId"
            : args[1].startsWith("v-")
              ? "viewId"
              : "collectionId"
      ] = args[1];
    const result = await client.request(op, input);
    if (op === "doctor" && result.capabilityVersion !== 1)
      throw Error("Upgrade to a runtime with views capability 1");
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(
      JSON.stringify({ error: e.code ?? "INVALID_INPUT", message: e.message }),
    );
    process.exitCode = 1;
  }
}
