"use client";
import { useEffect, useRef, useState } from "react";
import type { LongitudinalView } from "@geminilight/mindos/knowledge";
import { Button } from "@/components/ui/button";
import { useEchoDraft, clearEchoDrafts } from "../use-echo-draft";
import { StudyTextField } from "../research/StudyFields";
export default function LongitudinalParticipant({
  id,
  zh,
}: {
  id: string;
  zh: boolean;
}) {
  const [view, setView] = useState<LongitudinalView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [erase, setErase] = useState(false);
  const base = "/api/study/longitudinal/" + id,
    t = (en: string, cn: string) => (zh ? cn : en);
  const [draft, setDraft] = useEchoDraft(
    `${id}:${view?.id ?? "none"}:${view?.round ?? 0}:${view?.stage ?? view?.status ?? "none"}`,
    { answer: "", question: "", method: "", evidence: "" },
  );
  const lock = useRef(false),
    pending = useRef<{ key: string; body: unknown } | null>(null);
  async function call(url: string, method = "GET", body?: unknown) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(url, {
        method,
        cache: "no-store",
        signal: AbortSignal.timeout(method === "PATCH" ? 100000 : 20000),
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const data = await res.json();
      if (!res.ok) throw Error();
      setView(data.view);
      return data.view as LongitudinalView;
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const invitation = useRef<string | null>(null);
  async function resume() {
    const next = invitation.current
      ? await call(base + "/session", "POST", { token: invitation.current })
      : await call(base);
    if (next) invitation.current = null;
  }
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("token");
    if (token) {
      history.replaceState(history.state, "", location.pathname);
      invitation.current = token;
      void resume();
    } else void call(base);
  }, [id]);
  async function send(action: string, extra: Record<string, unknown> = {}) {
    if (!view || busy) return;
    const key = JSON.stringify({ action, ...extra });
    if (pending.current?.key !== key)
      pending.current = {
        key,
        body: {
          action,
          ...extra,
          version: view.version,
          requestId: crypto.randomUUID(),
        },
      };
    const next = await call(base, "PATCH", pending.current.body);
    if (next) {
      pending.current = null;
      if (action === "help") setDraft({ ...draft, question: "" });
      else setDraft({ answer: "", question: "", method: "", evidence: "" });
      if (action === "withdraw") clearEchoDrafts(id + ":");
    }
  }
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <h1 className="font-display text-2xl">
        {view?.title ?? t("Study participation", "研究参与")}
      </h1>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {t(
            "Could not complete the request. Input is preserved. Retry or check saved progress.",
            "请求未完成，输入已保留。可重试或核对已保存进度。",
          )}
        </p>
      ) : null}
      <Button
        className="min-h-11 h-auto whitespace-normal"
        variant="outline"
        disabled={busy}
        onClick={resume}
      >
        {t("Check saved progress", "核对已保存进度")}
      </Button>
      {!view ? (
        <p className="text-sm">
          {t(
            "Open your private participant invitation to begin.",
            "请使用你的私有参与链接进入。",
          )}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("Round", "轮次")} {view.round + 1}/{view.roundCount}
          </p>
          {view.status === "consent" ? (
            <>
              <p className="whitespace-pre-wrap text-sm leading-6">
                {view.consent}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-6">
                {view.withdrawal}
              </p>
              <Button
                className="min-h-11 h-auto whitespace-normal"
                disabled={busy}
                onClick={() => send("consent")}
              >
                {t("I agree and begin", "我同意并开始")}
              </Button>
            </>
          ) : null}
          {view.status === "answering" ? (
            <>
              <h2 className="font-display text-xl">
                {view.stage === "before"
                  ? t("Independent judgment", "独立判断")
                  : view.stage === "coaching"
                    ? t("Work with Agent help", "与 Agent 协作")
                    : t("Independent transfer", "独立迁移")}
              </h2>
              <p className="whitespace-pre-wrap leading-7">{view.task}</p>
              {view.stage === "coaching" ? (
                <div className="space-y-4">
                  <details>
                    <summary className="min-h-11 cursor-pointer py-3 text-sm">
                      {t("Method used for this round", "本轮使用的方法")}
                    </summary>
                    <p className="whitespace-pre-wrap text-sm">{view.method}</p>
                  </details>
                  {view.runs.map((run) => (
                    <div
                      key={run.id}
                      className="space-y-2 rounded-lg border border-border p-4"
                    >
                      <p className="text-sm whitespace-pre-wrap">
                        {run.question}
                      </p>
                      <p className="text-sm whitespace-pre-wrap leading-6">
                        {run.output ??
                          (run.status === "pending"
                            ? t("Working…", "正在处理…")
                            : t(
                                "No complete reply. You can ask again or continue without help.",
                                "未获得完整回复，可以再次提问或继续作答。",
                              ))}
                      </p>
                    </div>
                  ))}
                  <StudyTextField
                    name="help-question"
                    label={t("Question for the Agent", "向 Agent 提问")}
                    value={draft.question}
                    max={2000}
                    multiline
                    onChange={(question) => setDraft({ ...draft, question })}
                  />
                  <Button
                    className="min-h-11 h-auto whitespace-normal"
                    disabled={
                      busy ||
                      !draft.question.trim() ||
                      view.runs.length >= 4 ||
                      view.runs.filter((x) => x.status === "succeeded")
                        .length >= 2
                    }
                    variant="outline"
                    onClick={() => send("help", { question: draft.question })}
                  >
                    {t("Ask for help", "请求帮助")}
                  </Button>
                </div>
              ) : null}
              <StudyTextField
                name="independent-answer"
                label={t("Your answer", "你的作答")}
                value={draft.answer}
                max={4000}
                multiline
                onChange={(answer) => setDraft({ ...draft, answer })}
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "Unsubmitted input stays on this device for 7 days. Submitting locks this answer.",
                  "未提交输入在本机保留 7 天。提交后本阶段作答将被锁定。",
                )}
              </p>
              <Button
                className="min-h-11 h-auto whitespace-normal"
                disabled={busy || !draft.answer.trim()}
                onClick={() => send("answer", { answer: draft.answer })}
              >
                {t("Submit and continue", "提交并继续")}
              </Button>
            </>
          ) : null}
          {view.status === "revision" ? (
            <>
              <h2 className="font-display text-xl">
                {t("Reflect on the method", "回看本轮方法")}
              </h2>
              {view.updateAllowed ? (
                <>
                  <StudyTextField
                    name="revised-method"
                    label={t("Revised method", "修订后的方法")}
                    value={draft.method}
                    max={4000}
                    multiline
                    onChange={(method) => setDraft({ ...draft, method })}
                  />
                  <StudyTextField
                    name="revision-evidence"
                    label={t(
                      "Evidence and reason for the change",
                      "修改依据与理由",
                    )}
                    value={draft.evidence}
                    max={4000}
                    multiline
                    onChange={(evidence) => setDraft({ ...draft, evidence })}
                  />
                  <Button
                    className="min-h-11 h-auto whitespace-normal"
                    disabled={
                      busy || !draft.method.trim() || !draft.evidence.trim()
                    }
                    onClick={() =>
                      send("revise", {
                        method: draft.method,
                        evidence: draft.evidence,
                      })
                    }
                  >
                    {t("Submit for review", "提交审核")}
                  </Button>
                </>
              ) : (
                <p className="text-sm">
                  {t(
                    "This round has no revision window under the frozen protocol.",
                    "冻结协议规定，本轮不开放修订。",
                  )}
                </p>
              )}
              <Button
                className="min-h-11 h-auto whitespace-normal"
                variant="outline"
                disabled={busy}
                onClick={() => send("keep")}
              >
                {t("Keep the current method", "保留当前方法")}
              </Button>
            </>
          ) : null}
          {view.status === "review" ? (
            <p role="status">
              {t(
                "Your revision is saved and awaiting review.",
                "修订已保存，等待审核。",
              )}
            </p>
          ) : null}
          {view.status === "waiting" ? (
            <p role="status">
              {t("The next round opens at", "下一轮开放时间")}{" "}
              {new Date(view.dueAt!).toLocaleString(zh ? "zh-CN" : "en-US")}
            </p>
          ) : null}
          {view.status === "ready" ? (
            <Button
              className="min-h-11 h-auto whitespace-normal"
              disabled={busy}
              onClick={() => send("continue")}
            >
              {t("Start next round", "开始下一轮")}
            </Button>
          ) : null}
          {view.status === "complete" ? (
            <p role="status">
              {t(
                "All rounds are complete. Thank you.",
                "所有轮次已完成，谢谢。",
              )}
            </p>
          ) : null}
          {view.status === "withdrawn" ? (
            <p role="status">{t("You have withdrawn.", "你已退出研究。")}</p>
          ) : (
            <details className="border-t border-border pt-4">
              <summary className="min-h-11 cursor-pointer py-3 text-sm">
                {t("Withdraw from this study", "退出本研究")}
              </summary>
              <p className="whitespace-pre-wrap text-sm">{view.withdrawal}</p>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  checked={erase}
                  onChange={(e) => setErase(e.target.checked)}
                />
                {t(
                  "Also erase my answers, methods and replies",
                  "同时删除我的作答、方法与回复",
                )}
              </label>
              <Button
                className="min-h-11 h-auto whitespace-normal"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (confirm(t("Withdraw now?", "确认退出？")))
                    void send("withdraw", { erase });
                }}
              >
                {t("Confirm withdrawal", "确认退出")}
              </Button>
            </details>
          )}
        </>
      )}
    </main>
  );
}
