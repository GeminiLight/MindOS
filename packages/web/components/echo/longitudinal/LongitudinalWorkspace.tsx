"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LongitudinalProtocol } from "@geminilight/mindos/knowledge";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/stores/locale-store";
import { useEchoDraft, EchoDraftNotice } from "../use-echo-draft";
import { StudyTextField } from "../research/StudyFields";
const api = "/api/echo/longitudinal";
const control =
  "min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const blankRound = () => ({
  before: "",
  coaching: "",
  after: "",
  reference: "",
  updateAllowed: false,
});
type Export = ReturnType<
  typeof import("@geminilight/mindos/knowledge").exportLongitudinal
>;
export default function LongitudinalWorkspace() {
  const { locale } = useLocale(),
    zh = locale === "zh",
    t = (en: string, cn: string) => (zh ? cn : en);
  const [draft, setDraft] = useEchoDraft("longitudinal:new", {
    title: "",
    hypothesis: "",
    consent: "",
    withdrawal: "",
    reviewedBy: "",
    reviewNote: "",
    capacity: 2,
    delayHours: 24,
    baselineMethod: "",
    rubric: "",
    rounds: [{ ...blankRound(), updateAllowed: true }, blankRound()],
  });
  const [runtime, setRuntime] = useState<
      LongitudinalProtocol["runtime"] | null
    >(null),
    [studies, setStudies] = useState<
      { id: string; title: string; participants: number }[]
    >([]),
    [study, setStudy] = useState<Export | null>(null);
  const [accessReady, setAccessReady] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [invitation, setInvitation] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [reviews, setReviews] = useState<
      Record<string, { reviewedBy: string; reason: string }>
    >({});
  const pending = useRef<{ payload: string; id: string } | null>(null),
    lock = useRef(false);
  async function call(url = api, method = "GET", body?: unknown) {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(url, {
        method,
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.code || "storage");
      if (typeof d.accessReady === "boolean") setAccessReady(d.accessReady);
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : "storage");
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    const d = await call();
    if (d) {
      setStudies(d.studies);
      setRuntime(d.runtime);
    }
  }
  useEffect(() => {
    void refresh();
  }, []); // Load once; typing never triggers server adoption.
  async function load(id: string) {
    const d = await call(api + "?id=" + id);
    if (d?.study) {
      setStudy(d.study);
      setInvitation("");
    }
  }
  async function freeze() {
    if (!runtime || !confirmed) return;
    const protocol = { ...draft, runtime },
      payload = JSON.stringify(protocol);
    if (pending.current?.payload !== payload)
      pending.current = { payload, id: crypto.randomUUID() };
    const d = await call(api, "POST", {
      requestId: pending.current.id,
      protocol,
    });
    if (d?.id) {
      pending.current = null;
      await load(d.id);
    }
  }
  async function invite() {
    if (!study) return;
    const payload = "invite:" + study.id;
    if (pending.current?.payload !== payload)
      pending.current = { payload, id: crypto.randomUUID() };
    const d = await call(api, "PATCH", {
      id: study.id,
      action: "invite",
      requestId: pending.current.id,
    });
    if (d?.token) {
      pending.current = null;
      setInvitation(
        location.origin +
          "/study/longitudinal/" +
          study.id +
          "#token=" +
          d.token,
      );
      const result = await call(api + "?id=" + study.id);
      if (result?.study) setStudy(result.study);
    }
  }
  async function review(
    participantId: string,
    round: number,
    decision: "approved" | "rejected",
  ) {
    if (!study) return;
    const data = reviews[participantId + ":" + round];
    if (!data?.reviewedBy.trim() || !data.reason.trim()) return;
    const d = await call(api, "PATCH", {
      id: study.id,
      action: "review",
      participantId,
      round,
      decision,
      ...data,
    });
    if (d?.study) setStudy(d.study);
  }
  const field = (name: keyof typeof draft, label: string, max = 4000) => (
    <StudyTextField
      key={name}
      name={"long-" + name}
      label={label}
      value={String(draft[name])}
      max={max}
      multiline={name !== "title" && name !== "reviewedBy"}
      onChange={(v) => setDraft({ ...draft, [name]: v })}
    />
  );
  return (
    <section
      aria-label={t("Multi-round study workspace", "多轮研究工作区")}
      className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-8"
    >
      <Link
        href="/echo/research"
        className="inline-flex min-h-11 items-center text-sm underline"
      >
        {t("Research", "研究")}
      </Link>
      <h1 className="font-display text-2xl">
        {t("Multi-round coevolution", "多轮共同进化")}
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        {t(
          "Two randomly assigned groups get the same tasks and revision opportunities. Reviewed updates enter the next round in one group; the other retains the baseline method throughout. Each round separates independent work, Agent help and independent transfer.",
          "两组随机分配，任务与修订机会相同。一组的审核修订从下一轮生效，另一组全程保留初始方法。每轮区分独立作答、Agent 帮助和独立迁移。",
        )}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {t(
            "Could not save or load. Your input is preserved. Check configuration or refresh saved progress.",
            "保存或读取失败，输入已保留。请检查配置或刷新已保存进度。",
          )}{" "}
          ({error})
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          className="min-h-11 h-auto whitespace-normal"
          variant="outline"
          disabled={busy}
          onClick={() => (study ? load(study.id) : refresh())}
        >
          {t("Refresh saved progress", "刷新已保存进度")}
        </Button>
        {study ? (
          <Button
            className="min-h-11 h-auto whitespace-normal"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setStudy(null);
              void refresh();
            }}
          >
            {t("Study list", "研究列表")}
          </Button>
        ) : null}
      </div>
      {!study ? (
        <>
          {studies.length ? (
            <div className="space-y-2">
              {studies.map((s) => (
                <button
                  key={s.id}
                  className={control + " block w-full text-left"}
                  disabled={busy}
                  onClick={() => load(s.id)}
                >
                  {s.title} · {s.participants} {t("invitations", "个邀请")}
                </button>
              ))}
            </div>
          ) : null}
          <details
            open={!studies.length}
            className="rounded-lg border border-border p-4"
          >
            <summary className="min-h-11 cursor-pointer py-3 font-medium">
              {t("Prepare a new study", "准备新研究")}
            </summary>
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                void freeze();
              }}
            >
              <fieldset disabled={busy} className="space-y-5">
                <EchoDraftNotice />
                {field("title", t("Study title", "研究名称"), 200)}
                {field("hypothesis", t("Hypothesis", "检验假设"))}
                {field("consent", t("Consent information", "知情说明"), 6000)}
                {field(
                  "withdrawal",
                  t("Withdrawal and erasure information", "退出与删除说明"),
                )}
                {field(
                  "baselineMethod",
                  t("Initial method (both groups)", "初始方法（两组相同）"),
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {(["capacity", "delayHours"] as const).map((key) => (
                    <label key={key} className="space-y-2 text-sm block">
                      <span>
                        {key === "capacity"
                          ? t("Maximum invitations", "邀请人数上限")
                          : t(
                              "Hours between rounds (0 for workflow QA)",
                              "轮次间隔小时（流程测试可填 0）",
                            )}
                      </span>
                      <input
                        className={control + " w-full"}
                        type="number"
                        min={key === "capacity" ? 2 : 0}
                        max={key === "capacity" ? 100 : 2160}
                        value={draft[key]}
                        onChange={(e) =>
                          setDraft({ ...draft, [key]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                {draft.rounds.map((r, i) => (
                  <details
                    key={i}
                    open={i === 0}
                    className="rounded-lg border border-border p-4"
                  >
                    <summary className="min-h-11 cursor-pointer py-3">
                      {t("Round", "第")} {i + 1}
                      {zh ? " 轮" : ""}
                    </summary>
                    <div className="space-y-4">
                      {(
                        ["before", "coaching", "after", "reference"] as const
                      ).map((key, n) => (
                        <StudyTextField
                          key={key}
                          name={"round-" + i + "-" + key}
                          label={t(
                            [
                              "Independent task before help",
                              "Assisted practice task",
                              "New independent transfer task",
                              "Private scoring reference",
                            ][n],
                            [
                              "帮助前独立任务",
                              "协作练习任务",
                              "新的独立迁移任务",
                              "私有评分参考",
                            ][n],
                          )}
                          value={r[key]}
                          max={4000}
                          multiline
                          onChange={(v) =>
                            setDraft({
                              ...draft,
                              rounds: draft.rounds.map((x, j) =>
                                j === i ? { ...x, [key]: v } : x,
                              ),
                            })
                          }
                        />
                      ))}
                      {i < draft.rounds.length - 1 ? (
                        <label className="flex min-h-11 items-center gap-3 text-sm">
                          <input
                            type="checkbox"
                            className="size-5 shrink-0 accent-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            checked={r.updateAllowed}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                rounds: draft.rounds.map((x, j) =>
                                  j === i
                                    ? { ...x, updateAllowed: e.target.checked }
                                    : x,
                                ),
                              })
                            }
                          />
                          {t(
                            "Offer a method revision after this round",
                            "本轮结束后允许修订方法",
                          )}
                        </label>
                      ) : null}
                    </div>
                  </details>
                ))}
                <div className="flex gap-3">
                  <Button
                    className="min-h-11 h-auto whitespace-normal"
                    type="button"
                    variant="outline"
                    disabled={draft.rounds.length >= 6}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        rounds: [...draft.rounds, blankRound()],
                      })
                    }
                  >
                    {t("Add round", "增加轮次")}
                  </Button>
                  <Button
                    className="min-h-11 h-auto whitespace-normal"
                    type="button"
                    variant="ghost"
                    disabled={draft.rounds.length <= 2}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        rounds: draft.rounds
                          .slice(0, -1)
                          .map((r, i) =>
                            i === draft.rounds.length - 2
                              ? { ...r, updateAllowed: false }
                              : r,
                          ),
                      })
                    }
                  >
                    {t("Remove last round", "移除最后一轮")}
                  </Button>
                </div>
                {field("rubric", t("Scoring rubric", "评分规则"))}
                {field("reviewedBy", t("Protocol reviewer", "协议审核人"), 80)}
                {field(
                  "reviewNote",
                  t("Protocol review notes", "协议审核说明"),
                  2000,
                )}
                <p className="text-sm">
                  {runtime
                    ? `${runtime.provider} / ${runtime.model} · ${t("Temperature", "温度")} ${runtime.temperature} · ${runtime.maxOutputTokens} ${t("tokens per reply, including reasoning", "每次回复 token 上限（含推理）")}`
                    : t(
                        "Configure a compatible model in Settings first.",
                        "请先在设置中配置兼容模型。",
                      )}
                </p>
                <label className="flex min-h-11 gap-3 items-start text-sm">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  {t(
                    "I reviewed the tasks, revision windows, delay, consent and fixed model. Freeze these rules for this study.",
                    "我已审核任务、修订窗口、间隔、知情说明与固定模型，确认冻结本研究规则。",
                  )}
                </label>
                <Button
                  className="min-h-11 h-auto whitespace-normal"
                  type="submit"
                  disabled={!runtime || !confirmed || busy}
                >
                  {t("Freeze study", "冻结研究")}
                </Button>
              </fieldset>
            </form>
          </details>
        </>
      ) : (
        <section className="space-y-5">
          <h2 className="font-display text-xl">{study.protocol.title}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "Protocol frozen. Model, tasks and update rules cannot change during this study.",
              "协议已冻结。模型、任务与生效规则在研究期间不能修改。",
            )}
          </p>
          {!accessReady ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t(
                "Before creating participant links, enable a Web password and an access token in Settings. Remote participation requires HTTPS.",
                "创建参与链接前，请在设置中启用网页密码和访问令牌；远程参与需使用 HTTPS。",
              )}{" "}
              <Link href="/settings?tab=knowledge" className="underline">
                {t("Open Settings", "打开设置")}
              </Link>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              className="min-h-11 h-auto whitespace-normal"
              disabled={
                busy ||
                !accessReady ||
                study.participants.length >= study.protocol.capacity
              }
              onClick={invite}
            >
              {t("Create participant link", "创建参与链接")}
            </Button>
            <Button
              className="min-h-11 h-auto whitespace-normal"
              variant="outline"
              onClick={() => {
                const u = URL.createObjectURL(
                  new Blob([JSON.stringify(study, null, 2)], {
                    type: "application/json",
                  }),
                );
                const a = document.createElement("a");
                a.href = u;
                a.download = study.id + ".json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(u), 1000);
              }}
            >
              {t("Download study record", "下载研究记录")}
            </Button>
          </div>
          {invitation ? (
            <label className="block space-y-2 text-sm">
              <span>
                {t(
                  "Private participant link; copy to share deliberately.",
                  "参与者私有链接，可复制后自行分享。",
                )}
              </span>
              <input
                readOnly
                value={invitation}
                className={control + " w-full"}
                onFocus={(e) => e.target.select()}
              />
            </label>
          ) : null}
          {study.participants.map((p, n) => (
            <details
              key={p.id}
              className="rounded-lg border border-border p-4"
              open={p.rounds.some((r) => r.revision?.decision === "pending")}
            >
              <summary className="min-h-11 cursor-pointer py-3">
                {t("Participant", "参与者")} {n + 1} ·{" "}
                {p.withdrawnAt
                  ? t("Withdrawn", "已退出")
                  : t("Rounds started", "已开始轮次") + " " + p.rounds.length}
              </summary>
              {p.rounds.map((r, i) => (
                <div key={i} className="space-y-3 border-t border-border py-4">
                  <h3 className="font-medium">
                    {t("Round", "轮次")} {i + 1}
                  </h3>
                  <p className="text-sm whitespace-pre-wrap">
                    {t("Agent method", "Agent 使用的方法")}: {r.method}
                  </p>
                  {r.revision ? (
                    <>
                      <p className="whitespace-pre-wrap text-sm">
                        {r.revision.method}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {r.revision.evidence}
                      </p>
                      {r.revision.decision === "pending" ? (
                        <div className="space-y-3">
                          {(["reviewedBy", "reason"] as const).map((key) => (
                            <StudyTextField
                              key={key}
                              name={p.id + i + key}
                              label={
                                key === "reason"
                                  ? t("Review reason", "审核理由")
                                  : t("Reviewer", "审核人")
                              }
                              value={reviews[p.id + ":" + i]?.[key] ?? ""}
                              max={key === "reason" ? 2000 : 80}
                              onChange={(v) =>
                                setReviews({
                                  ...reviews,
                                  [p.id + ":" + i]: {
                                    ...(reviews[p.id + ":" + i] ?? {
                                      reviewedBy: "",
                                      reason: "",
                                    }),
                                    [key]: v,
                                  },
                                })
                              }
                            />
                          ))}
                          <div className="flex gap-3">
                            <Button
                              className="min-h-11 h-auto whitespace-normal"
                              disabled={busy}
                              onClick={() => review(p.id, i, "approved")}
                            >
                              {t("Approve revision", "批准修订")}
                            </Button>
                            <Button
                              className="min-h-11 h-auto whitespace-normal"
                              disabled={busy}
                              variant="outline"
                              onClick={() => review(p.id, i, "rejected")}
                            >
                              {t("Reject revision", "拒绝修订")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm">
                          {r.revision.decision === "approved"
                            ? t("Approved", "已批准")
                            : t("Rejected", "已拒绝")}{" "}
                          · {r.revision.reason}
                        </p>
                      )}
                    </>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {r.answers.length}/3{" "}
                    {t("submitted answers", "份已提交作答")} ·{" "}
                    {r.runs.filter((x) => x.status === "succeeded").length}{" "}
                    {t("completed Agent replies", "次已完成回复")}
                  </p>
                </div>
              ))}
            </details>
          ))}
        </section>
      )}
    </section>
  );
}
