"use client";
import { useEffect, useRef, useState } from "react";
import type { LongitudinalView } from "@geminilight/mindos/knowledge";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NarrowPageShell } from "@/components/shared/ContentPageShell";
import { cn } from "@/lib/utils";
import { useEchoDraft, clearEchoDrafts, EchoDraftNotice } from "../use-echo-draft";
import { StudyTextField, studyNote } from "../research/StudyFields";
import { longitudinalCopy, type LongitudinalCopy } from "./longitudinal-copy";

type ErrorCode = keyof LongitudinalCopy["participant"]["errors"];
const stageOrder = ["before", "coaching", "after"] as const;
const check = "mt-1 size-5 shrink-0 accent-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const summary = "min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function StageSteps({ current, labels, name }: { current: number; labels: readonly string[]; name: string }) {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label={name}>
      {labels.map((label, index) => (
        <li key={label} aria-current={index === current ? "step" : undefined}
          className={cn("border-t-2 pt-2 text-xs leading-5 sm:text-sm", index === current ? "border-[var(--amber)] text-foreground" : index < current ? "border-[var(--amber)]/40 text-muted-foreground" : "border-border text-muted-foreground")}>
          <span className="mr-1.5 font-mono text-xs">{index < current ? <Check size={12} className="inline" aria-hidden /> : "0" + (index + 1)}</span>{label}
        </li>
      ))}
    </ol>
  );
}

export default function LongitudinalParticipant({ id, zh }: { id: string; zh: boolean }) {
  const p = longitudinalCopy[zh ? "zh" : "en"].participant;
  const format = (value: string) => new Date(value).toLocaleString(zh ? "zh-CN" : "en-US");
  const [view, setView] = useState<LongitudinalView | null>(null);
  const [busy, setBusy] = useState(false);
  const [helping, setHelping] = useState(false);
  const [error, setError] = useState<ErrorCode | "">("");
  const [consented, setConsented] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [erase, setErase] = useState(false);
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false);
  const [lastAction, setLastAction] = useState("");
  const base = "/api/study/longitudinal/" + id;
  const [draft, setDraft] = useEchoDraft(
    `${id}:${view?.id ?? "none"}:${view?.round ?? 0}:${view?.stage ?? view?.status ?? "none"}`,
    { answer: "", question: "", method: "", evidence: "" },
  );
  const lock = useRef(false);
  const pending = useRef<{ key: string; body: unknown } | null>(null);
  const invitation = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const stateKey = view ? `${view.status}:${view.round}:${view.stage ?? ""}` : "";
  useEffect(() => { if (stateKey) heading.current?.focus(); }, [stateKey]);
  useEffect(() => { setConfirmed(false); }, [stateKey]);

  async function call(url: string, method = "GET", body?: unknown) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const res = await fetch(url, {
        method, cache: "no-store", credentials: "same-origin",
        signal: AbortSignal.timeout(method === "PATCH" ? 130000 : 20000),
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError((data.code in p.errors ? data.code : "storage") as ErrorCode); return; }
      setView(data.view);
      return data.view as LongitudinalView;
    } catch { setError("storage"); }
    finally { lock.current = false; setBusy(false); setHelping(false); }
  }
  async function resume() {
    const next = invitation.current ? await call(base + "/session", "POST", { token: invitation.current }) : await call(base);
    if (next) invitation.current = null;
  }
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("token");
    if (token) {
      history.replaceState(history.state, "", location.pathname);
      invitation.current = token;
      void resume();
    } else void call(base);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send(action: string, extra: Record<string, unknown> = {}) {
    if (!view || busy) return;
    const key = JSON.stringify({ action, ...extra, round: view.round, stage: view.stage });
    if (pending.current?.key !== key) pending.current = { key, body: { action, ...extra, version: view.version, requestId: crypto.randomUUID() } };
    if (action === "help") setHelping(true);
    const next = await call(base, "PATCH", pending.current.body);
    if (next) {
      pending.current = null; setLastAction(action);
      if (action === "help") setDraft({ ...draft, question: "" });
      else setDraft({ answer: "", question: "", method: "", evidence: "" });
      if (action === "withdraw") clearEchoDrafts(id + ":");
    }
  }

  const stageIndex = view?.stageIndex ?? (view?.stage ? stageOrder.indexOf(view.stage) : 0);
  const help = view?.help;
  const helpPending = !!view?.runs.some((run) => run.status === "pending");
  const helpExhausted = !!help && (help.attempts >= help.maxAttempts || help.succeeded >= help.maxSucceeded);
  const canWithdraw = !!view && view.status !== "withdrawn" && view.status !== "consent";

  return (
    <NarrowPageShell as="main" aria-labelledby="longitudinal-title" className="min-h-[calc(100dvh-var(--app-titlebar-h))] space-y-7">
      <header className="space-y-3">
        <p className={studyNote}>MindOS</p>
        <h1 id="longitudinal-title" ref={heading} tabIndex={-1} className="rounded font-display text-3xl break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {view?.title ?? p.title}
        </h1>
        {view && view.status !== "consent" && view.status !== "withdrawn" ? <p className={studyNote}>{p.roundOf(view.round + 1, view.roundCount)}</p> : null}
      </header>
      {busy ? <p role="status" className={studyNote}>{helping ? p.asking : null}</p> : null}
      {error ? (
        <div role="alert" className="space-y-3 rounded-lg border border-error p-4">
          <p className="text-sm leading-7">{p.errors[error]}</p>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void resume()}>{p.check}</Button>
        </div>
      ) : null}
      {!view ? <p className="text-sm leading-7">{p.missingLink}</p> : null}

      {view?.status === "consent" ? (
        <section className="space-y-5">
          <p className="whitespace-pre-wrap break-words leading-7">{view.consent}</p>
          <p className={studyNote + " whitespace-pre-wrap break-words"}>{view.withdrawal}</p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
            <input type="checkbox" name="consent" className={check} checked={consented} disabled={busy} onChange={(e) => setConsented(e.target.checked)} />
            <span>{p.consentCheck}</span>
          </label>
          <Button className="min-h-11" disabled={busy || !consented} onClick={() => void send("consent")}>{p.begin}</Button>
        </section>
      ) : null}

      {view?.status === "answering" && view.stage ? (
        <section className="space-y-6">
          <StageSteps current={stageIndex} labels={p.stages} name={p.roundOf(view.round + 1, view.roundCount)} />
          <div className="space-y-2">
            <h2 className="font-display text-xl">{p.stages[stageIndex]}</h2>
            <p className={studyNote}>{p.stageHints[stageIndex]}</p>
          </div>
          {lastAction === "answer" ? <p role="status" className={studyNote}>{p.locked}</p> : null}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.task}</p>
            <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/25 p-4 leading-7">{view.task}</p>
          </div>
          {view.stage === "coaching" ? (
            <section className="space-y-4 border-y border-border py-5" aria-label={p.help}>
              {view.previousAnswer ? (
                <details><summary className={summary}>{p.previousAnswer}</summary><p className="whitespace-pre-wrap break-words pb-2 text-sm leading-6">{view.previousAnswer}</p></details>
              ) : null}
              {view.method ? (
                <details><summary className={summary}>{p.method}</summary><p className="whitespace-pre-wrap break-words pb-2 text-sm leading-6">{view.method}</p></details>
              ) : null}
              <h3 className="font-display text-lg">{p.help}</h3>
              <p className={studyNote}>{p.helpNote}</p>
              {help ? <p className={studyNote} aria-live="polite">{p.helpBudget(help.succeeded, help.maxSucceeded, help.attempts, help.maxAttempts)}</p> : null}
              {view.runs.map((run, index) => (
                <article key={run.id} className="space-y-2 border-l-2 border-border pl-4">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{index + 1}. {run.question}</p>
                  {run.output ? <p className="whitespace-pre-wrap break-words leading-7">{run.output}</p>
                    : <p role="status" className={studyNote}>{p.runState[run.status === "pending" ? "pending" : run.status === "interrupted" ? "interrupted" : "failed"]}</p>}
                </article>
              ))}
              {helpExhausted ? <p className={studyNote}>{p.helpExhausted}</p> : helpPending ? (
                <div className="space-y-3"><p className={studyNote}>{p.helpPending}</p><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void resume()}>{p.check}</Button></div>
              ) : (
                <>
                  <StudyTextField name="help-question" label={p.question} value={draft.question} max={2000} multiline onChange={(question) => setDraft({ ...draft, question })} />
                  <Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy || !draft.question.trim()} onClick={() => void send("help", { question: draft.question })}>{p.ask}</Button>
                </>
              )}
            </section>
          ) : null}
          <form onSubmit={(e) => { e.preventDefault(); if (!busy && confirmed && draft.answer.trim() && !helpPending) void send("answer", { answer: draft.answer }); }}>
            <fieldset disabled={busy || helpPending} className="space-y-4">
              <StudyTextField name="independent-answer" label={p.answer} value={draft.answer} max={4000} multiline onChange={(answer) => setDraft({ ...draft, answer })} />
              <EchoDraftNotice />
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
                <input type="checkbox" name="confirmAnswer" className={check} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>{p.confirm}</span>
              </label>
              <Button type="submit" className="min-h-11 h-auto whitespace-normal" disabled={busy || helpPending || !confirmed || !draft.answer.trim()}>{p.submit}</Button>
            </fieldset>
          </form>
        </section>
      ) : null}

      {view?.status === "revision" ? (
        <section className="space-y-5">
          <h2 className="font-display text-xl">{p.reflect}</h2>
          <p className={studyNote}>{p.reflectHint}</p>
          {view.method ? <div className="space-y-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.currentMethod}</p><p className="whitespace-pre-wrap break-words rounded-lg bg-muted/25 p-4 text-sm leading-6">{view.method}</p></div> : null}
          {view.updateAllowed ? (
            <form onSubmit={(e) => { e.preventDefault(); if (!busy && draft.method.trim() && draft.evidence.trim()) void send("revise", { method: draft.method, evidence: draft.evidence }); }}>
              <fieldset disabled={busy} className="space-y-4">
                <StudyTextField name="revised-method" label={p.revisedMethod} value={draft.method} max={4000} multiline onChange={(method) => setDraft({ ...draft, method })} />
                <StudyTextField name="revision-evidence" label={p.revisionEvidence} value={draft.evidence} max={4000} multiline onChange={(evidence) => setDraft({ ...draft, evidence })} />
                <EchoDraftNotice />
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" className="min-h-11 h-auto whitespace-normal" disabled={busy || !draft.method.trim() || !draft.evidence.trim()}>{p.submitRevision}</Button>
                  <Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy} onClick={() => void send("keep")}>{p.keep}</Button>
                </div>
              </fieldset>
            </form>
          ) : (
            <><p className="text-sm leading-6">{p.noWindow}</p><Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy} onClick={() => void send("keep")}>{p.keep}</Button></>
          )}
        </section>
      ) : null}

      {view?.status === "review" || view?.status === "waiting" || view?.status === "ready" ? (
        <section className="space-y-4">
          {view.status === "review" ? <p role="status" className="leading-7">{p.review}</p> : null}
          {view.status === "waiting" ? <p role="status" className="leading-7">{p.waiting} <time dateTime={view.dueAt}>{format(view.dueAt!)}</time></p> : null}
          {view.status === "ready" ? <p role="status" className="leading-7">{p.ready}</p> : null}
          {view.revision && view.revision.decision !== "pending" ? <p className="text-sm leading-6">{p.decision[view.revision.decision]}{view.revision.reason ? ` ${view.revision.reason}` : ""}</p> : null}
          {view.revision ? <details><summary className={summary}>{p.yourRevision}</summary><p className="whitespace-pre-wrap break-words pb-2 text-sm leading-6">{view.revision.method}</p><p className={studyNote + " whitespace-pre-wrap break-words pb-2"}>{view.revision.evidence}</p></details> : null}
          <div className="flex flex-wrap gap-3">
            {view.status === "ready" ? <Button className="min-h-11" disabled={busy} onClick={() => void send("continue")}>{p.next}</Button> : null}
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void resume()}>{p.check}</Button>
          </div>
        </section>
      ) : null}

      {view?.status === "complete" ? <section className="space-y-2"><h2 className="font-display text-xl">{p.complete}</h2><p className={studyNote}>{p.completeNote}</p></section> : null}
      {view?.status === "withdrawn" ? <p role="status" className="leading-7">{p.withdrawn}</p> : null}

      {canWithdraw ? (
        <details className="border-t border-border pt-4">
          <summary className={summary}>{p.withdraw}</summary>
          <div className="space-y-3 pb-2">
            <p className={studyNote + " whitespace-pre-wrap break-words"}>{view!.withdrawal}</p>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6"><input type="checkbox" name="erase" className={check} checked={erase} disabled={busy} onChange={(e) => { setErase(e.target.checked); setWithdrawConfirmed(false); }} /><span>{p.erase}</span></label>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6"><input type="checkbox" name="confirmWithdrawal" className={check} checked={withdrawConfirmed} disabled={busy} onChange={(e) => setWithdrawConfirmed(e.target.checked)} /><span>{p.withdrawConfirm}</span></label>
            <Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy || !withdrawConfirmed} onClick={() => void send("withdraw", { erase })}>{p.confirmWithdraw}</Button>
          </div>
        </details>
      ) : null}
    </NarrowPageShell>
  );
}
