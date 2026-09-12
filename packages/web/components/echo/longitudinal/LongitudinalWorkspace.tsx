"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LongitudinalProtocol, LongitudinalSummary } from "@geminilight/mindos/knowledge";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useLocale } from "@/lib/stores/locale-store";
import { useEchoDraft } from "../use-echo-draft";
import { studyNote } from "../research/StudyFields";
import LongitudinalProtocolForm, { blankProtocol, type ProtocolDraft } from "./LongitudinalProtocolForm";
import LongitudinalStudyBoard, { type BoardData } from "./LongitudinalStudyBoard";
import { longitudinalCopy, type LongitudinalCopy } from "./longitudinal-copy";

const api = "/api/echo/longitudinal";
type ErrorCode = keyof LongitudinalCopy["workspace"]["errors"];
type Runtime = LongitudinalProtocol["runtime"];

export function ReadinessRow({ ready, text, action }: { ready: boolean; text: string; action?: { href: string; label: string } }) {
  return (
    <li className="flex flex-wrap items-start gap-3 py-2 text-sm leading-6">
      {ready ? <CheckCircle2 size={18} className="mt-1 shrink-0 text-success" aria-hidden /> : <AlertCircle size={18} className="mt-1 shrink-0 text-[var(--amber)]" aria-hidden />}
      <span className="min-w-0 flex-1">{text}</span>
      {!ready && action ? <Link href={action.href} className={buttonVariants({ variant: "outline", size: "sm" }) + " min-h-11"}>{action.label}</Link> : null}
    </li>
  );
}

export default function LongitudinalWorkspace() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const copy = longitudinalCopy[zh ? "zh" : "en"];
  const p = copy.workspace;
  const [draft, setDraft] = useEchoDraft<ProtocolDraft>("longitudinal:new", blankProtocol);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [studies, setStudies] = useState<LongitudinalSummary[]>([]);
  const [unavailable, setUnavailable] = useState(0);
  const [accessReady, setAccessReady] = useState(false);
  const [study, setStudy] = useState<BoardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ErrorCode | "">("");
  const [invitation, setInvitation] = useState("");
  const pending = useRef<{ payload: string; id: string } | null>(null);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // Announce list ↔ study switches to assistive tech without stealing focus on the initial page load.
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } heading.current?.focus(); }, [study?.study.id]);

  async function call(url = api, method = "GET", body?: unknown) {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(url, { method, cache: "no-store", signal: AbortSignal.timeout(20000), ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError((data.code in p.errors ? data.code : "storage") as ErrorCode); return null; }
      if (typeof data.accessReady === "boolean") setAccessReady(data.accessReady);
      return data;
    } catch { setError("storage"); return null; }
    finally { lock.current = false; setBusy(false); }
  }
  async function refresh() {
    const data = await call();
    if (data) { setStudies(Array.isArray(data.studies) ? data.studies : []); setUnavailable(data.unavailableCount ?? 0); setRuntime(data.runtime ?? null); }
    setLoaded(true);
  }
  async function load(id: string) {
    const data = await call(api + "?id=" + encodeURIComponent(id));
    if (data?.study) { setStudy(data as BoardData); setInvitation(""); }
    setLoaded(true);
  }
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function freeze() {
    if (!runtime) return;
    const protocol = { ...draft, runtime };
    const payload = JSON.stringify(protocol);
    if (pending.current?.payload !== payload) pending.current = { payload, id: crypto.randomUUID() };
    const data = await call(api, "POST", { requestId: pending.current.id, protocol });
    if (data?.id) { pending.current = null; setDraft(blankProtocol()); await load(data.id); }
  }
  async function invite() {
    if (!study) return;
    const payload = "invite:" + study.study.id;
    if (pending.current?.payload !== payload) pending.current = { payload, id: crypto.randomUUID() };
    const data = await call(api, "PATCH", { id: study.study.id, action: "invite", requestId: pending.current.id });
    if (data?.token) {
      pending.current = null;
      setInvitation(location.origin + "/study/longitudinal/" + study.study.id + "#token=" + data.token);
      const result = await call(api + "?id=" + encodeURIComponent(study.study.id));
      if (result?.study) setStudy(result as BoardData);
    }
  }
  async function review(participantId: string, round: number, decision: "approved" | "rejected", reviewedBy: string, reason: string) {
    if (!study) return false;
    const data = await call(api, "PATCH", { id: study.study.id, action: "review", participantId, round, decision, reviewedBy, reason });
    if (data?.study) { setStudy(data as BoardData); return true; }
    return false;
  }
  return (
    <section aria-labelledby="longitudinal-title" className="mx-auto w-full max-w-4xl space-y-7 px-4 py-8 md:px-6 md:py-10">
      <header className="space-y-3">
        <Link href="/echo/research" className={buttonVariants({ variant: "ghost" }) + " min-h-11 -ml-2 w-fit"}>{p.back}</Link>
        <h1 id="longitudinal-title" ref={heading} tabIndex={-1} className="rounded font-display text-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{study ? study.study.protocol.title : p.title}</h1>
        {!study ? <p className={studyNote}>{p.lead}</p> : null}
      </header>
      {error ? (
        <div role="alert" className="space-y-3 rounded-lg border border-error p-4">
          <p className="text-sm leading-7">{p.errors[error]}</p>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => (study ? void load(study.study.id) : void refresh())}>{p.refresh}</Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => (study ? void load(study.study.id) : void refresh())}>{p.refresh}</Button>
        {study ? <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => { setStudy(null); void refresh(); }}>{p.list}</Button> : null}
      </div>
      {study ? (
        <LongitudinalStudyBoard data={study} locale={zh ? "zh" : "en"} busy={busy} onInvite={() => void invite()} invitation={invitation} onReview={review} p={copy.board} />
      ) : (
        <div className="space-y-8" aria-busy={busy && !loaded}>
          {loaded ? (
            <section className="space-y-2" aria-labelledby="readiness-title">
              <h2 id="readiness-title" className="font-display text-lg">{p.readiness}</h2>
              <ul className="divide-y divide-border rounded-xl border border-border px-4">
                <ReadinessRow ready={!!runtime} text={runtime ? `${p.modelReady}: ${copy.form.runtimeSummary(runtime.provider, runtime.model, runtime.temperature, runtime.maxOutputTokens)}` : p.modelMissing} action={{ href: "/settings?tab=ai", label: p.aiSettings }} />
                <ReadinessRow ready={accessReady} text={accessReady ? p.accessReady : p.accessMissing} action={{ href: "/settings?tab=knowledge", label: p.settings }} />
              </ul>
            </section>
          ) : null}
          <section className="space-y-3" aria-labelledby="studies-title">
            <h2 id="studies-title" className="font-display text-lg">{p.studies}{studies.length ? ` · ${studies.length}` : ""}</h2>
            {unavailable ? <p role="status" className={studyNote}>{p.unavailable}</p> : null}
            {loaded && !studies.length ? <p className={studyNote}>{p.none}</p> : null}
            {studies.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {studies.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 space-y-1">
                      <p className="break-words font-medium leading-6">{item.title}</p>
                      <p className={studyNote}>
                        {item.participants}/{item.capacity} {p.participants} · {item.rounds} {p.rounds} · {item.active} {p.active} · {item.complete} {p.complete}
                        {item.pendingReviews ? <span className="text-[var(--amber)]"> · {item.pendingReviews} {p.pending}</span> : null}
                        {` · ${p.updated} ${new Date(item.updatedAt).toLocaleString(zh ? "zh-CN" : "en-US")}`}
                      </p>
                    </div>
                    <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void load(item.id)}>{p.open}</Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <details open={loaded && !studies.length} className="rounded-xl border border-border p-4 sm:p-5">
            <summary className="min-h-11 cursor-pointer rounded py-2 font-display text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.prepare}</summary>
            <div className="pt-4">
              <LongitudinalProtocolForm draft={draft} setDraft={setDraft} runtime={runtime} busy={busy} onFreeze={() => void freeze()} p={copy.form} />
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
