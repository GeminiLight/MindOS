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
