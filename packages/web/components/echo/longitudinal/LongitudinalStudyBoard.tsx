"use client";
import { useRef, useState } from "react";
import type { LongitudinalAdminView } from "@geminilight/mindos/knowledge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadJson } from "@/lib/download-json";
import { StudyTextField, studyNote } from "../research/StudyFields";
import type { LongitudinalCopy } from "./longitudinal-copy";

export type BoardData = LongitudinalAdminView & { accessReady: boolean };
type Participant = BoardData["study"]["participants"][number];
const summaryClass = "min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const control = "min-h-11 w-full rounded-md border border-[var(--muted-foreground)] bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Chip({ tone = "muted", children }: { tone?: "muted" | "amber" | "error" | "success"; children: React.ReactNode }) {
  return <span className={cn("inline-flex min-h-6 items-center rounded-md border px-2 text-xs leading-5", tone === "amber" ? "border-[var(--amber)]/40 text-[var(--amber)]" : tone === "error" ? "border-error/40 text-error" : tone === "success" ? "border-success/40 text-success" : "border-border text-muted-foreground")}>{children}</span>;
}

export default function LongitudinalStudyBoard({ data, locale, busy, onInvite, invitation, onReview, p }: {
  data: BoardData; locale: "en" | "zh"; busy: boolean;
  onInvite: () => void; invitation: string;
  onReview: (participantId: string, round: number, decision: "approved" | "rejected", reviewedBy: string, reason: string) => void;
  p: LongitudinalCopy["board"];
}) {
  const { study, progress, summary, accessReady } = data;
  const format = (value?: string) => (value ? new Date(value).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") : "");
  const label = (participant: Participant | { id: string }) => "P" + (study.participants.findIndex((x) => x.id === participant.id) + 1);
  const [reviews, setReviews] = useState<Record<string, { reviewedBy: string; reason: string }>>({});
  const [feedback, setFeedback] = useState("");
  const [copyState, setCopyState] = useState("");
  const exporting = useRef(false);
  const pendingReviews = study.participants.flatMap((participant) => participant.withdrawnAt ? [] :
    participant.rounds.flatMap((round, index) => (round.revision?.decision === "pending" ? [{ participant, round, index }] : [])));
  async function exportFile(kind: "record" | "review" | "key") {
    if (exporting.current) return;
    exporting.current = true; setFeedback("");
    try {
      let payload: unknown = study;
      if (kind !== "record") {
        const response = await fetch(`/api/echo/longitudinal?id=${encodeURIComponent(study.id)}&packet=${kind}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error("export");
        payload = await response.json();
      }
      setFeedback(downloadJson(`${study.id}${kind === "record" ? "" : "-" + kind}.json`, payload) ? p.exportStarted : p.exportFailed);
    } catch { setFeedback(p.exportFailed); }
    finally { exporting.current = false; }
  }
  const tiles: [string, number | string][] = [
    [p.invited, `${summary.invited} / ${summary.capacity}`], [p.consented, summary.consented], [p.active, summary.active], [p.complete, summary.complete],
    [p.withdrawn, summary.withdrawn], [p.pendingReviews, summary.pendingReviews], [p.failedRuns, summary.failedRuns],
  ];
  return (
    <div className="space-y-8">
      <p className={studyNote}>{p.frozen}</p>
      <section aria-label={p.summary}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(([name, value]) => (
            <div key={name} className="rounded-lg border border-border p-3"><dt className="text-xs text-muted-foreground">{name}</dt><dd className="mt-1 font-mono text-xl">{value}</dd></div>
          ))}
        </dl>
      </section>

      <section className="space-y-4" aria-labelledby="pending-reviews-title">
        <h2 id="pending-reviews-title" className="font-display text-xl">{p.reviews}{pendingReviews.length ? ` · ${pendingReviews.length}` : ""}</h2>
        {!pendingReviews.length ? <p className={studyNote}>{p.noReviews}</p> : pendingReviews.map(({ participant, round, index }) => {
          const key = participant.id + ":" + index; const draft = reviews[key] ?? { reviewedBy: "", reason: "" };
          const ready = !!draft.reviewedBy.trim() && !!draft.reason.trim();
          return (
            <article key={key} className="space-y-4 rounded-xl border border-[var(--amber)]/40 p-4">
              <p className="text-sm font-medium">{label(participant)} · {p.strategy[participant.strategy]} · {locale === "zh" ? `第 ${index + 1} 轮` : `${p.round} ${index + 1}`}</p>
              <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.revised}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{round.revision!.method}</p></div>
              <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.evidence}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{round.revision!.evidence}</p></div>
              <fieldset disabled={busy} className="space-y-3">
                <StudyTextField name={`review-${key}-by`} label={p.reviewedBy} value={draft.reviewedBy} max={80} onChange={(v) => setReviews({ ...reviews, [key]: { ...draft, reviewedBy: v } })} />
                <StudyTextField name={`review-${key}-reason`} label={p.reason} value={draft.reason} max={2000} multiline onChange={(v) => setReviews({ ...reviews, [key]: { ...draft, reason: v } })} />
                <div className="flex flex-wrap gap-3">
                  <Button className="min-h-11" disabled={busy || !ready} onClick={() => onReview(participant.id, index, "approved", draft.reviewedBy, draft.reason)}>{p.approve}</Button>
                  <Button variant="outline" className="min-h-11" disabled={busy || !ready} onClick={() => onReview(participant.id, index, "rejected", draft.reviewedBy, draft.reason)}>{p.reject}</Button>
                </div>
              </fieldset>
            </article>
          );
        })}
      </section>

      <section className="space-y-4" aria-labelledby="participants-title">
        <h2 id="participants-title" className="font-display text-xl">{p.participants}{progress.length ? ` · ${progress.length}` : ""}</h2>
        {!progress.length ? <p className={studyNote}>{p.noParticipants}</p> : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {progress.map((row) => {
              const participant = study.participants.find((x) => x.id === row.id)!;
              const tone = row.status === "withdrawn" ? "muted" : row.revisionPending ? "amber" : row.status === "complete" ? "success" : "muted";
              return (
                <li key={row.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{label(row)}</span>
                    <span className="text-muted-foreground">{p.strategy[row.strategy]}</span>
                    <Chip tone={tone}>{p.status[row.status]}</Chip>
                    {row.status !== "consent" && row.status !== "withdrawn" ? <span className="text-muted-foreground">{locale === "zh" ? `第 ${row.round + 1}/${row.roundCount} 轮` : `${p.round} ${row.round + 1}/${row.roundCount}`}{row.stage ? ` · ${p.stage[row.stage]}` : ""}</span> : null}
                    {row.erased ? <Chip>{p.erased}</Chip> : null}
                    {row.helpFailed ? <Chip tone="error">{row.helpFailed} {p.failed}</Chip> : null}
                  </div>
                  <p className={studyNote}>
                    {row.answers} {p.answers} · {p.help} {row.helpSucceeded} {p.succeeded}
                    {row.status === "waiting" && row.dueAt ? ` · ${p.dueAt} ${format(row.dueAt)}` : ""}
                    {row.lastActivityAt ? ` · ${p.lastActivity} ${format(row.lastActivityAt)}` : ""}
                  </p>
                  {participant.rounds.length ? (
                    <details><summary className={summaryClass}>{p.details}</summary>
                      <ol className="space-y-3 pb-2">{participant.rounds.map((round, index) => (
                        <li key={index} className="space-y-1 border-l-2 border-border pl-3 text-sm">
                          <p className="font-medium">{locale === "zh" ? `第 ${index + 1} 轮` : `${p.round} ${index + 1}`} · {round.answers.length} {p.answers} · {round.runs.filter((r) => r.status === "succeeded").length} {p.help}</p>
                          <details><summary className="min-h-11 cursor-pointer py-2 text-xs text-muted-foreground">{p.method}</summary><p className="whitespace-pre-wrap break-words text-sm leading-6">{round.method}</p></details>
                          {round.revision ? <p className={studyNote}>{p.decided[round.revision.decision]}{round.revision.reason ? ` · ${round.revision.reason}` : ""}</p> : null}
                        </li>
                      ))}</ol>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="invitations-title">
        <h2 id="invitations-title" className="font-display text-xl">{p.invitations}</h2>
        <p className={studyNote}>{p.linkNote}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button className="min-h-11" disabled={busy || !accessReady || summary.invited >= summary.capacity} onClick={onInvite}>{p.invite}</Button>
          {summary.invited >= summary.capacity ? <span className={studyNote}>{p.capacityReached}</span> : null}
        </div>
        {invitation ? (
          <div className="space-y-2">
            <label className="block space-y-2 text-sm font-medium" htmlFor="study-invitation-link"><span>{p.invitations}</span>
              <input id="study-invitation-link" readOnly value={invitation} className={control + " font-mono text-xs"} onFocus={(e) => e.target.select()} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" className="min-h-11" onClick={async () => { try { await navigator.clipboard.writeText(invitation); setCopyState(p.copied); } catch { setCopyState(p.manual); } }}>{p.copy}</Button>
              {copyState ? <span role="status" className={studyNote}>{copyState}</span> : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-4" aria-labelledby="exports-title">
        <h2 id="exports-title" className="font-display text-xl">{p.exports}</h2>
        <ul className="space-y-4">
          {([["record", p.record, p.recordNote], ["review", p.packet, p.packetNote], ["key", p.key, p.keyNote]] as const).map(([kind, title, note]) => (
            <li key={kind} className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
              <p className={studyNote + " max-w-xl"}>{note}</p>
              <Button variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={busy} onClick={() => void exportFile(kind)}>{title}</Button>
            </li>
          ))}
        </ul>
        {feedback ? <p role="status" className={studyNote}>{feedback}</p> : null}
      </section>

      <details className="border-t border-border pt-2">
        <summary className={summaryClass}>{p.protocol}</summary>
        <dl className="space-y-4 pb-2 text-sm leading-6">
          <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.initialMethod}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{study.protocol.baselineMethod}</dd></div>
          <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.rubric}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{study.protocol.rubric}</dd></div>
          <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.method}</dt><dd className="mt-1 font-mono text-xs">{study.protocol.runtime.provider} / {study.protocol.runtime.model} · t={study.protocol.runtime.temperature} · {study.protocol.runtime.maxOutputTokens} tokens · {study.protocol.delayHours}h</dd></div>
          {study.protocol.rounds.map((round, index) => (
            <div key={index}><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{locale === "zh" ? `第 ${index + 1} 轮` : `${p.round} ${index + 1}`}{round.updateAllowed ? " · ↻" : ""}</dt>
              <dd className="mt-1 space-y-2">{([round.before, round.coaching, round.after, round.reference]).map((text, i) => <p key={i} className={cn("whitespace-pre-wrap break-words", i === 3 && "text-muted-foreground")}>{text}</p>)}</dd></div>
          ))}
        </dl>
      </details>
    </div>
  );
}
