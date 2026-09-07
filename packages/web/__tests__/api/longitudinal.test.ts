import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createLongitudinal,
  issueLongitudinalAccess,
} from "@geminilight/mindos/knowledge";
import { GET, PATCH } from "@/app/api/study/longitudinal/[id]/route";
import { POST } from "@/app/api/study/longitudinal/[id]/session/route";
import { GET as admin } from "@/app/api/echo/longitudinal/route";
import { testMindRoot } from "../setup";
vi.mock("@/lib/runtime-auth-config", () => ({
  readRuntimeAuthConfig: () => ({
    authToken: "owner",
    webPassword: "password",
    webSessionSecret: "secret",
  }),
}));
vi.mock("@/lib/jwt", () => ({
  verifyJwt: vi.fn(async () => ({ exp: 9999999999 })),
}));
vi.mock("@/lib/method-comparison-runtime", () => ({
  currentComparisonRuntime: () => null,
}));
vi.mock("@/lib/study-coaching-executor", () => ({
  executeMethodComparison: vi.fn(),
}));
let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "long-api-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
const request = (
  id: string,
  method = "GET",
  body?: unknown,
  cookie = "",
  extra = {},
) =>
  new NextRequest("http://localhost/api/study/longitudinal/" + id, {
    method,
    headers: { Cookie: cookie, ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
function seed() {
  const s = createLongitudinal(testMindRoot, {
    requestId: "create",
    protocol: {
      title: "QA",
      hypothesis: "Test",
      consent: "Consent",
      withdrawal: "Erase",
      reviewedBy: "qa",
      reviewNote: "QA",
      capacity: 2,
      delayHours: 0,
      baselineMethod: "PRIVATE METHOD",
      rubric: "PRIVATE RUBRIC",
      runtime: {
        adapter: "isolated-chat-v1",
        provider: "openai",
        model: "k3",
        endpoint: "https://example.test/v1/chat/completions",
        temperature: 1,
        maxOutputTokens: 1024,
        tools: [],
      },
      rounds: [0, 1].map((i) => ({
        before: "Before " + i,
        coaching: "PRIVATE HELP " + i,
        after: "PRIVATE TRANSFER " + i,
        reference: "PRIVATE ANSWER",
        updateAllowed: i === 0,
      })),
    },
  });
  const inv = issueLongitudinalAccess(testMindRoot, s.id, {
    requestId: "invite",
  });
  return { s, inv, ctx: { params: Promise.resolve({ id: s.id }) } };
}
it("uses a scoped HttpOnly invitation cookie and hides future tasks and condition allocation", async () => {
  const { s, inv, ctx } = seed();
  expect((await GET(request(s.id), ctx)).status).toBe(401);
  const session = await POST(request(s.id, "POST", { token: inv.token }), ctx);
  expect(session.status).toBe(200);
  expect(session.headers.get("set-cookie")).toContain("HttpOnly");
  expect(session.headers.get("set-cookie")).toContain(
    "Path=/api/study/longitudinal/" + s.id,
  );
  const cookie = "mindos-long-" + s.id + "=" + inv.token;
  const v = (await session.json()).view;
  const r = await PATCH(
    request(
      s.id,
      "PATCH",
      { action: "consent", version: v.version, requestId: "consent" },
      cookie,
    ),
    ctx,
  );
  expect(r.status).toBe(200);
  const body = JSON.stringify(await r.json());
  expect(body).toContain("Before 0");
  expect(body).not.toMatch(/PRIVATE|strategy|tokenHash|allocation|Before 1/);
});
it("rejects cross-origin requests, forged participant state and owner-bearer access to admin exports", async () => {
  const { s, inv, ctx } = seed();
  expect(
    (
      await POST(
        request(s.id, "POST", { token: inv.token }, "", {
          Origin: "https://other.test",
        }),
        ctx,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        request(s.id, "POST", { token: inv.token, role: "owner" }),
        ctx,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await PATCH(
        request(
          s.id,
          "PATCH",
          { action: "consent", version: 1, requestId: "x", strategy: "frozen" },
          "mindos-long-" + s.id + "=" + inv.token,
        ),
        ctx,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await admin(
        new NextRequest("http://localhost/api/echo/longitudinal?id=" + s.id, {
          headers: { Authorization: "Bearer owner" },
        }),
      )
    ).status,
  ).toBe(401);
});
