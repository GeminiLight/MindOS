import { readFileSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { createHash } from "node:crypto";
/** Fail closed before any test creates data; a flag alone is not isolation. */
export function viewsFixtureIdentity(env = process.env) {
  const root = env.MINDOS_VIEWS_TEST_ROOT,
    config = env.MINDOS_VIEWS_TEST_CONFIG;
  if (env.MINDOS_VIEWS_ISOLATED !== "1" || !root || !config || !env.MINDOS_VIEWS_FIXTURE_TOKEN)
    throw new Error(
      "Run pnpm test:views:isolated; a disposable Views fixture is required.",
    );
  const absolute = resolve(root),
    base = dirname(absolute);
  if (
    !basename(base).startsWith("mindos-views-e2e-") ||
    basename(absolute) !== "knowledge" ||
    resolve(config) !== join(base, "home", ".mindos", "config.json")
  )
    throw new Error("Views tests refuse persistent or unrelated libraries.");
  const marker = JSON.parse(readFileSync(join(base, "fixture.json"), "utf8"));
  if (
    marker.purpose !== "disposable-views-e2e" ||
    marker.root !== absolute ||
    marker.token !== env.MINDOS_VIEWS_FIXTURE_TOKEN ||
    !Number.isFinite(marker.createdAt) ||
    Date.now() - marker.createdAt > 6 * 60 * 60 * 1000
  )
    throw new Error("Missing or stale Views fixture ownership.");
  if (JSON.parse(readFileSync(config, "utf8")).mindRoot !== absolute)
    throw new Error("Fixture configuration points to another library.");
  return createHash("sha256").update(absolute).digest("hex").slice(0, 24);
}
export async function assertViewsFixture(request, env = process.env) {
  const expected = viewsFixtureIdentity(env);
  const response = await request.get("/api/views/v2?op=describe");
  if (!response.ok() || (await response.json()).rootId !== expected)
    throw new Error(
      "The server does not own this disposable fixture; refusing all test writes.",
    );
}
