import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  viewsFixtureIdentity,
  assertViewsFixture,
} from "./helpers/views-fixture.mjs";
it("refuses a human preview URL even when the old opt-in flag is present", async () => {
  expect(() =>
    viewsFixtureIdentity({
      MINDOS_VIEWS_ISOLATED: "1",
      MINDOS_VIEWS_TEST_ROOT: "/tmp/human/knowledge",
      MINDOS_VIEWS_TEST_CONFIG: "/tmp/human/home/.mindos/config.json",
    }),
  ).toThrow();
  const base = mkdtempSync(join(tmpdir(), "mindos-views-e2e-"));
  const root = join(base, "knowledge"),
    config = join(base, "home/.mindos/config.json");
  mkdirSync(join(base, "home/.mindos"), { recursive: true });
  writeFileSync(config, JSON.stringify({ mindRoot: root }));
  const env = {
    MINDOS_VIEWS_ISOLATED: "1",
    MINDOS_VIEWS_TEST_ROOT: root,
    MINDOS_VIEWS_TEST_CONFIG: config,
    MINDOS_VIEWS_FIXTURE_TOKEN: "owned",
  };
  try {
    expect(() => viewsFixtureIdentity(env)).toThrow();
    writeFileSync(
      join(base, "fixture.json"),
      JSON.stringify({
        purpose: "disposable-views-e2e",
        root,
        token: "owned",
        createdAt: Date.now(),
      }),
    );
    const id = viewsFixtureIdentity(env);
    expect(id).toMatch(/^[a-f0-9]{24}$/);
    await expect(
      assertViewsFixture(
        {
          get: async () => ({
            ok: () => true,
            json: async () => ({ rootId: "human-preview" }),
          }),
        },
        env,
      ),
    ).rejects.toThrow("refusing all test writes");
    await expect(
      assertViewsFixture(
        {
          get: async () => ({
            ok: () => true,
            json: async () => ({ rootId: id }),
          }),
        },
        env,
      ),
    ).resolves.toBeUndefined();
    expect(() =>
      viewsFixtureIdentity({ ...env, MINDOS_VIEWS_FIXTURE_TOKEN: "foreign" }),
    ).toThrow();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
