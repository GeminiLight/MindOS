import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  createLongitudinal,
  issueLongitudinalAccess,
  readLongitudinal,
  useLongitudinal,
  reviewLongitudinalMethod,
  beginLongitudinalHelp,
  finishLongitudinalHelp,
  exportLongitudinal,
  listLongitudinal,
} from "./index.js";
let home: string, root: string;
const protocol = () => ({
  title: "QA longitudinal",
  consent: "Synthetic QA consent",
  withdrawal: "You may withdraw and erase",
  hypothesis: "Updating helps transfer",
  reviewedBy: "qa",
  reviewNote: "QA protocol review",
  capacity: 2,
  delayHours: 0,
  baselineMethod: "Check evidence",
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
    before: "Independent " + i,
    coaching: "Practice " + i,
    after: "Transfer " + i,
    reference: "SECRET RUBRIC " + i,
    updateAllowed: i === 0,
  })),
  rubric: "Quality and limitations",
});
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "long-"));
  root = path.join(home, "mind");
  fs.mkdirSync(root);
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
function setup() {
  const s = createLongitudinal(root, {
    requestId: "create",
    protocol: protocol(),
  });
  const invite = issueLongitudinalAccess(root, s.id, { requestId: "invite" });
  return { s, ...invite };
}
function cmd(s: string, t: string, action: string, extra = {}) {
  const v = readLongitudinal(root, s, t);
  return useLongitudinal(root, s, t, {
    action,
    version: v.version,
    requestId: Math.random().toString(36).slice(2),
    ...extra,
  });
}
function round(s: string, t: string) {
  cmd(s, t, "consent");
  cmd(s, t, "answer", { answer: "Independent answer" });
  cmd(s, t, "answer", { answer: "Joint answer" });
  cmd(s, t, "answer", { answer: "Transfer answer" });
}
it("persists balanced assignments, locked answers, reviewed methods and round-specific activation", () => {
  const { s, token } = setup();
  const other = issueLongitudinalAccess(root, s.id, { requestId: "other" });
  round(s.id, token);
  round(s.id, other.token);
  for (const t of [token, other.token]) {
    let v = cmd(s.id, t, "revise", {
      method: "Check randomization",
      evidence: "My transfer answer shows a missing boundary",
    });
    expect(v.status).toBe("review");
    reviewLongitudinalMethod(root, s.id, {
      participantId: v.id,
      round: 0,
      decision: "approved",
      reason: "Appropriate scope",
      reviewedBy: "qa",
    });
    cmd(s.id, t, "continue");
    cmd(s.id, t, "answer", { answer: "Second independent answer" });
  }
  const e = exportLongitudinal(root, s.id);
  expect(e.participants.map((p) => p.strategy).sort()).toEqual([
    "frozen",
    "next-round",
  ]);
  for (const p of e.participants) {
    const tokenFor =
      p.id === readLongitudinal(root, s.id, token).id ? token : other.token;
    const v = readLongitudinal(root, s.id, tokenFor);
    const run = beginLongitudinalHelp(root, s.id, tokenFor, {
      version: v.version,
      requestId: "run",
      question: "Help me reason",
    });
    expect(JSON.stringify(run.request)).not.toMatch(
      /SECRET|Independent 1|Transfer 1/,
    );
    expect(run.request!.messages[0].content).toContain(
      p.strategy === "next-round" ? "Check randomization" : "Check evidence",
    );
    finishLongitudinalHelp(root, s.id, run.runId, {
      status: "succeeded",
      output: "Consider the design.",
    });
  }
  expect(listLongitudinal(root).studies).toHaveLength(1);
  expect(
    exportLongitudinal(root, s.id).participants.every(
      (p) => p.rounds[1].runs[0].status === "succeeded",
    ),
  ).toBe(true);
});
it("rejects forged conditions, stale submissions and help outside the assisted stage", () => {
  const { s, token } = setup();
  const v = readLongitudinal(root, s.id, token);
  expect(() =>
    useLongitudinal(root, s.id, token, {
      action: "consent",
      version: v.version,
      requestId: "x",
      strategy: "next-round",
    }),
  ).toThrow();
  expect(() => readLongitudinal(root, s.id, "wrong")).toThrow();
  expect(() =>
    beginLongitudinalHelp(root, s.id, token, {
      version: v.version,
      requestId: "x",
      question: "leak",
    }),
  ).toThrow();
  cmd(s.id, token, "consent");
  expect(() =>
    useLongitudinal(root, s.id, token, {
      action: "answer",
      version: v.version,
      requestId: "x",
      answer: "stale",
    }),
  ).toThrow();
  expect(JSON.stringify(readLongitudinal(root, s.id, token))).not.toMatch(
    /SECRET|Practice 0|Transfer 0|allocation|tokenHash|strategy/,
  );
});
it("keeps retries idempotent and prevents a late result from restoring erased data", () => {
  const { s, token } = setup();
  cmd(s.id, token, "consent");
  cmd(s.id, token, "answer", { answer: "Before" });
  const v = readLongitudinal(root, s.id, token);
  const input = { version: v.version, requestId: "help", question: "Explain" };
  const run = beginLongitudinalHelp(root, s.id, token, input);
  expect(beginLongitudinalHelp(root, s.id, token, input).execute).toBe(false);
  cmd(s.id, token, "withdraw", { erase: true });
  finishLongitudinalHelp(root, s.id, run.runId, {
    status: "succeeded",
    output: "PRIVATE LATE",
  });
  expect(JSON.stringify(exportLongitudinal(root, s.id))).not.toMatch(
    /PRIVATE LATE|Before|Explain/,
  );
});
it("freezes update opportunities and delay instead of accepting participant overrides", () => {
  const p = protocol();
  p.delayHours = 24;
  const s = createLongitudinal(root, { requestId: "delay", protocol: p });
  const { token } = issueLongitudinalAccess(root, s.id, { requestId: "i" });
  round(s.id, token);
  cmd(s.id, token, "keep");
  expect(readLongitudinal(root, s.id, token).status).toBe("waiting");
  expect(() => cmd(s.id, token, "continue")).toThrow();
});
it("retains rejection, skips unavailable update windows, and does not activate rejected text", () => {
  const { s, token } = setup();
  round(s.id, token);
  let v = cmd(s.id, token, "revise", {
    method: "Unjustified causal certainty",
    evidence: "My answer",
  });
  reviewLongitudinalMethod(root, s.id, {
    participantId: v.id,
    round: 0,
    decision: "rejected",
    reason: "Unsupported",
    reviewedBy: "qa",
  });
  cmd(s.id, token, "continue");
  const p = exportLongitudinal(root, s.id).participants[0];
  expect(p.rounds[1].method).toBe("Check evidence");
  expect(p.rounds[0].revision?.decision).toBe("rejected");
});
it("does not collide help reservations across participants that reuse a client request ID", () => {
  const { s, token } = setup();
  const t2 = issueLongitudinalAccess(root, s.id, { requestId: "second" }).token;
  const runs = [token, t2].map((t) => {
    cmd(s.id, t, "consent");
    const v = cmd(s.id, t, "answer", { answer: "Answer" });
    return beginLongitudinalHelp(root, s.id, t, {
      version: v.version,
      requestId: "same",
      question: "Help",
    });
  });
  expect(runs[0].runId).not.toBe(runs[1].runId);
  finishLongitudinalHelp(root, s.id, runs[1].runId, {
    status: "succeeded",
    output: "Second participant only",
  });
  expect(readLongitudinal(root, s.id, token).runs[0].status).toBe("pending");
  expect(readLongitudinal(root, s.id, t2).runs[0].output).toBe(
    "Second participant only",
  );
});
it("rejects empty, oversized and invalid sampling protocols without creating records", () => {
  for (const patch of [
    { title: "" },
    { capacity: 0 },
    { delayHours: -1 },
    { baselineMethod: "x".repeat(4001) },
    { runtime: { ...protocol().runtime, temperature: NaN } },
  ])
    expect(() =>
      createLongitudinal(root, {
        requestId: "bad",
        protocol: { ...protocol(), ...patch },
      }),
    ).toThrow();
  expect(listLongitudinal(root).studies).toHaveLength(0);
});
it("returns the same creation and invitation on retries without redrawing allocation", () => {
  const { s, token } = setup();
  expect(
    createLongitudinal(root, { requestId: "create", protocol: protocol() }).id,
  ).toBe(s.id);
  expect(
    issueLongitudinalAccess(root, s.id, { requestId: "invite" }).token,
  ).toBe(token);
  expect(exportLongitudinal(root, s.id).participants).toHaveLength(1);
  expect(() =>
    createLongitudinal(root, {
      requestId: "create",
      protocol: { ...protocol(), title: "Changed" },
    }),
  ).toThrow();
});

import { comparisonRuntime } from "../method-comparisons/model.js";
it("validates frozen reasoning-inclusive budgets without weakening old records", () => {
 const r={adapter:"isolated-chat-v1", provider:"openai",model:"glm",endpoint:"https://example.test/v1/chat/completions",temperature:0,maxOutputTokens:1024,tools:[]};
 for(const maxOutputTokens of [1024,2048,4096]) expect(comparisonRuntime.safeParse({...r,maxOutputTokens}).success).toBe(true);
 for(const maxOutputTokens of [0,4097,1024.5,NaN]) expect(comparisonRuntime.safeParse({...r,maxOutputTokens}).success).toBe(false);
});

import {
  adminLongitudinal,
  exportLongitudinalReviewPacket,
  exportLongitudinalReviewKey,
} from "./index.js";
it("shows the participant's own earlier answer and the help budget only during the assisted stage", () => {
  const { s, token } = setup();
  cmd(s.id, token, "consent");
  let v = readLongitudinal(root, s.id, token);
  expect(v.stage).toBe("before");
  expect(v.previousAnswer).toBeUndefined();
  expect(v.help).toBeUndefined();
  v = cmd(s.id, token, "answer", { answer: "My first judgment" });
  expect(v.stage).toBe("coaching");
  expect(v.previousAnswer).toBe("My first judgment");
  expect(v.help).toEqual({ attempts: 0, maxAttempts: 4, succeeded: 0, maxSucceeded: 2 });
  const run = beginLongitudinalHelp(root, s.id, token, { version: v.version, requestId: "h1", question: "Why?" });
  finishLongitudinalHelp(root, s.id, run.runId, { status: "failed", failure: "provider" });
  v = readLongitudinal(root, s.id, token);
  expect(v.help).toEqual({ attempts: 1, maxAttempts: 4, succeeded: 0, maxSucceeded: 2 });
  expect(v.runs[0]).toMatchObject({ status: "failed", failure: "provider" });
  v = cmd(s.id, token, "answer", { answer: "Joint answer" });
  expect(v.stage).toBe("after");
  expect(v.previousAnswer).toBeUndefined();
  expect(v.help).toBeUndefined();
  expect(v.method).toBeUndefined();
  expect(JSON.stringify(v)).not.toMatch(/My first judgment|Why\?/);
  v = cmd(s.id, token, "answer", { answer: "Transfer answer" });
  expect(v.status).toBe("revision");
  expect(v.method).toBe("Check evidence");
});
it("builds a blind review packet with stable codes and no allocation, method text or participant identity", () => {
  const { s, token } = setup();
  const other = issueLongitudinalAccess(root, s.id, { requestId: "other" });
  round(s.id, token);
  round(s.id, other.token);
  const packet = exportLongitudinalReviewPacket(root, s.id);
  expect(packet.items).toHaveLength(6);
  expect(new Set(packet.items.map((i) => i.code)).size).toBe(6);
  expect(packet.items.every((i) => /^W\d{3}$/.test(i.code))).toBe(true);
  const text = JSON.stringify(packet);
  expect(text).not.toMatch(/participant-|frozen|next-round|Check evidence|tokenHash|methodHash|salt|strategy/);
  expect(text).toContain("SECRET RUBRIC 0");
  expect(text).toContain("Independent answer");
  expect(packet.rubric).toBe("Quality and limitations");
  expect(exportLongitudinalReviewPacket(root, s.id).items.map((i) => i.code + i.answer)).toEqual(
    packet.items.map((i) => i.code + i.answer),
  );
  const key = exportLongitudinalReviewKey(root, s.id);
  expect(key.items).toHaveLength(6);
  expect(key.items.every((k) => packet.items.some((p) => p.code === k.code))).toBe(true);
  expect(key.items.map((k) => k.strategy).sort()).toEqual([
    "frozen", "frozen", "frozen", "next-round", "next-round", "next-round",
  ]);
  const byCode = new Map(packet.items.map((i) => [i.code, i]));
  for (const k of key.items) expect(byCode.get(k.code)).toMatchObject({ round: k.round, stage: k.stage });
});
it("keeps erased answers out of packets and summarizes researcher progress without leaking to participants", () => {
  const { s, token } = setup();
  const other = issueLongitudinalAccess(root, s.id, { requestId: "other" });
  round(s.id, token);
  cmd(s.id, other.token, "consent");
  cmd(s.id, other.token, "answer", { answer: "Erase me" });
  cmd(s.id, other.token, "withdraw", { erase: true });
  const v = cmd(s.id, token, "revise", { method: "Check randomization", evidence: "Boundary" });
  expect(JSON.stringify(exportLongitudinalReviewPacket(root, s.id))).not.toContain("Erase me");
  expect(exportLongitudinalReviewKey(root, s.id).items).toHaveLength(3);
  const admin = adminLongitudinal(root, s.id);
  expect(admin.summary).toEqual({
    invited: 2, capacity: 2, consented: 2, active: 1, complete: 0, withdrawn: 1, pendingReviews: 1, failedRuns: 0, pendingRuns: 0,
  });
  const me = admin.progress.find((p) => p.id === v.id)!;
  expect(me).toMatchObject({ status: "review", round: 0, revisionPending: true });
  expect(admin.progress.find((p) => p.id !== v.id)).toMatchObject({ status: "withdrawn", erased: true });
  expect(admin.study.protocol.rubric).toBe("Quality and limitations");
  const list = listLongitudinal(root).studies[0]!;
  expect(list).toMatchObject({ participants: 2, capacity: 2, pendingReviews: 1, withdrawn: 1, complete: 0, rounds: 2 });
  expect(typeof list.updatedAt).toBe("string");
});
it("refuses packets and admin views for unknown studies without creating files", () => {
  expect(() => exportLongitudinalReviewPacket(root, "cohort-" + "0".repeat(24))).toThrow();
  expect(() => adminLongitudinal(root, "cohort-" + "0".repeat(24))).toThrow();
  expect(() => exportLongitudinalReviewKey(root, "not-a-study")).toThrow();
  expect(listLongitudinal(root).studies).toHaveLength(0);
});
