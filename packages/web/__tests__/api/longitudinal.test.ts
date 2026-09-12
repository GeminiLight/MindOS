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
it("serves researcher progress, blind packets and keys to the owner session only, keeping allocation out of packets", async () => {
  const { s, inv, ctx } = seed();
  const session = await POST(request(s.id, "POST", { token: inv.token }), ctx);
  const cookie = "mindos-long-" + s.id + "=" + inv.token;
  let view = (await session.json()).view;
  for (const [action, extra] of [
    ["consent", {}],
    ["answer", { answer: "First independent judgment" }],
  ] as const) {
    const r = await PATCH(
      request(s.id, "PATCH", { action, version: view.version, requestId: action, ...extra }, cookie),
      ctx,
    );
    expect(r.status).toBe(200);
    view = (await r.json()).view;
  }
  expect(view.stage).toBe("coaching");
  expect(view.previousAnswer).toBe("First independent judgment");
  expect(view.help).toMatchObject({ maxAttempts: 4, maxSucceeded: 2 });
  const owner = (query: string) =>
    admin(new NextRequest("http://localhost/api/echo/longitudinal" + query, { headers: { Cookie: "mindos-session=valid" } }));
  const detail = await owner("?id=" + s.id);
  expect(detail.status).toBe(200);
  const body = await detail.json();
  expect(body.summary).toMatchObject({ invited: 1, consented: 1, active: 1, pendingReviews: 0 });
  expect(body.progress[0]).toMatchObject({ status: "answering", stage: "coaching", round: 0 });
  expect(body.accessReady).toBe(true);
  const packet = await owner("?id=" + s.id + "&packet=review");
  expect(packet.status).toBe(200);
  const packetText = JSON.stringify(await packet.json());
  expect(packetText).toContain("First independent judgment");
  expect(packetText).not.toMatch(/participant-|strategy|frozen|next-round|PRIVATE METHOD/);
  const key = await owner("?id=" + s.id + "&packet=key");
  expect(JSON.stringify(await key.json())).toMatch(/participant-[a-f0-9]{24}/);
  expect((await owner("?id=" + s.id + "&packet=other")).status).toBe(400);
  expect((await owner("?packet=review")).status).toBe(400);
  expect((await owner("?id=" + s.id + "&extra=1")).status).toBe(400);
  expect(
    (
      await admin(
        new NextRequest("http://localhost/api/echo/longitudinal?id=" + s.id + "&packet=key", {
          headers: { Cookie: cookie },
        }),
      )
    ).status,
  ).toBe(401);
  const list = await owner("");
  expect((await list.json()).studies[0]).toMatchObject({ participants: 1, consented: 1, pendingReviews: 0, rounds: 2 });
});

it("restricts atomic export bundles to owner sessions and keeps all packet identities aligned", async () => {
  const {s}=seed(); const url="http://localhost/api/echo/longitudinal?id="+s.id+"&packet=bundle";
  expect((await admin(new NextRequest(url))).status).toBe(401);
  const response=await admin(new NextRequest(url,{headers:{Cookie:"mindos-session=owner-session"}}));
  expect(response.status).toBe(200);
  const bundle=await response.json();
  expect(bundle.review.packetId).toBe(bundle.key.packetId);
  expect(bundle.record.packetId).toBe(bundle.packetId);
  expect(JSON.stringify(bundle)).not.toMatch(/tokenHash|issueHash|commands|salt/);
});
