import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
it("ships one shared workflow with valid Codex and Claude manifests and no per-session latest install", () => {
  const root = resolve("plugins/mindos");
  expect(existsSync(root + "/plugin.json")).toBe(true);
  const codex = JSON.parse(readFileSync(root + "/plugin.json", "utf8")),
    claude = JSON.parse(
      readFileSync(root + "/.claude-plugin/plugin.json", "utf8"),
    );
  expect(codex.name).toBe(claude.name);
  expect(codex.extensions["com.openai"].onboardingSkill).toBe(
    "./skills/setup/SKILL.md",
  );
  const mcp = JSON.parse(readFileSync(root + "/mcp.json", "utf8"));
  expect(mcp.mcpServers.mindos.type).toBe("stdio");
  expect(JSON.stringify(mcp)).not.toContain("latest");
  expect(readFileSync(root + "/skills/mindos-views/SKILL.md", "utf8")).toBe(
    readFileSync("skills/mindos-views/SKILL.md", "utf8"),
  );
  expect(readFileSync(root + "/scripts/setup.mjs", "utf8")).toContain(
    "capabilityVersion",
  );
});

it.skipIf(!existsSync(".syncinclude"))("keeps both plugin marketplaces and hidden MCP manifests in the public sync projection", () => {
  const config = parse(readFileSync(".syncinclude", "utf8"));
  const files = [
    "plugins/mindos/plugin.json",
    "plugins/mindos/.mcp.json",
    "plugins/mindos/.claude-plugin/plugin.json",
    "plugins/.agents/plugins/marketplace.json",
    "plugins/.claude-plugin/marketplace.json",
    "plugins/mindos/scripts/mcp.mjs",
    "plugins/mindos/skills/mindos-views/SKILL.md",
  ];
  for (const file of files) {
    expect(existsSync(file), file).toBe(true);
    expect(config.directories.some((dir: string) => file.startsWith(dir + "/")), file).toBe(true);
  }
  expect(config.directories).not.toContain(".");
  expect(config.directories).not.toContain(".claude-internal");
  expect(config.blocked_patterns).toContain(".claude-internal/");
});
it("launches a setup-installed runtime without requiring a shell PATH change", async () => {
  const root = resolve("plugins/mindos");
  const portable = JSON.parse(readFileSync(root + "/mcp.json", "utf8"));
  const claude = JSON.parse(readFileSync(root + "/.mcp.json", "utf8"));
  expect(portable.mcpServers.mindos.command).toBe("node");
  expect(portable.mcpServers.mindos.args).toEqual([
    "${PLUGIN_ROOT}/scripts/mcp.mjs",
  ]);
  expect(claude.mcpServers.mindos.args).toEqual([
    "${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs",
  ]);
});
