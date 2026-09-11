"use client";
import { useState } from "react";
import type { LongitudinalProtocol } from "@geminilight/mindos/knowledge";
import { Button } from "@/components/ui/button";
import { StudyTextField, studyNote } from "../research/StudyFields";
import { EchoDraftNotice } from "../use-echo-draft";
import type { LongitudinalCopy } from "./longitudinal-copy";

export type RoundDraft = { before: string; coaching: string; after: string; reference: string; updateAllowed: boolean };
export type ProtocolDraft = Omit<LongitudinalProtocol, "runtime" | "rounds"> & { rounds: RoundDraft[] };
export const blankRound = (): RoundDraft => ({ before: "", coaching: "", after: "", reference: "", updateAllowed: false });
export const blankProtocol = (): ProtocolDraft => ({
  title: "", hypothesis: "", consent: "", withdrawal: "", reviewedBy: "", reviewNote: "",
  capacity: 2, delayHours: 24, baselineMethod: "", rubric: "",
  rounds: [{ ...blankRound(), updateAllowed: true }, blankRound()],
});
const control = "min-h-11 w-full rounded-md border border-[var(--muted-foreground)] bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const check = "mt-0.5 size-5 shrink-0 accent-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Missing = { field: string; label: string };

/** Required fields the server will reject when empty; mirrors protocolSchema without duplicating length rules. */
export function missingProtocolFields(draft: ProtocolDraft, runtimeReady: boolean, p: LongitudinalCopy["form"]): Missing[] {
  const missing: Missing[] = [];
  const text: [keyof ProtocolDraft, string][] = [
    ["title", p.title], ["hypothesis", p.hypothesis], ["consent", p.consent], ["withdrawal", p.withdrawal],
    ["baselineMethod", p.method], ["rubric", p.rubric], ["reviewedBy", p.reviewedBy], ["reviewNote", p.reviewNote],
  ];
  for (const [key, label] of text) if (!String(draft[key]).trim()) missing.push({ field: "long-" + key, label });
  if (!Number.isInteger(draft.capacity) || draft.capacity < 2 || draft.capacity > 100) missing.push({ field: "long-capacity", label: p.capacity });
  if (!Number.isInteger(draft.delayHours) || draft.delayHours < 0 || draft.delayHours > 2160) missing.push({ field: "long-delayHours", label: p.delay });
  draft.rounds.forEach((round, i) => {
    for (const key of ["before", "coaching", "after", "reference"] as const)
      if (!round[key].trim()) missing.push({ field: `round-${i}-${key}`, label: `${p.round} ${i + 1}${p.round === "第" ? " 轮" : ""} · ${p[key]}` });
  });
  if (!runtimeReady) missing.push({ field: "long-runtime", label: p.runtime });
  return missing;
}

export default function LongitudinalProtocolForm({ draft, setDraft, runtime, busy, onFreeze, p }: {
  draft: ProtocolDraft; setDraft: (next: ProtocolDraft) => void;
  runtime: LongitudinalProtocol["runtime"] | null; busy: boolean;
  onFreeze: () => void; p: LongitudinalCopy["form"];
}) {
  const [confirmed, setConfirmed] = useState(false);
  const missing = missingProtocolFields(draft, !!runtime, p);
  const roundLabel = (i: number) => (p.round === "第" ? `第 ${i + 1} 轮` : `${p.round} ${i + 1}`);
  const field = (name: keyof ProtocolDraft, label: string, max = 4000, multiline = true) => (
    <StudyTextField key={name} name={"long-" + name} label={label} value={String(draft[name])} max={max} multiline={multiline} onChange={(v) => { setDraft({ ...draft, [name]: v }); setConfirmed(false); }} />
  );
  const section = (title: string, children: React.ReactNode, hint?: string) => (
    <section className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="space-y-1"><h2 className="font-display text-lg">{title}</h2>{hint ? <p className={studyNote}>{hint}</p> : null}</div>
      {children}
    </section>
  );
  const focusField = (id: string) => document.getElementById("study-" + id)?.focus();
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (!missing.length && confirmed && !busy) onFreeze(); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        <EchoDraftNotice />
        {section(p.basics, <>{field("title", p.title, 200, false)}{field("hypothesis", p.hypothesis)}</>, p.hypothesisHint)}
        {section(p.participantInfo, <>{field("consent", p.consent, 6000)}{field("withdrawal", p.withdrawal)}</>)}
        {section(p.method, <>
          {field("baselineMethod", p.method)}
          <div id="study-long-runtime" tabIndex={-1} className="rounded-lg border border-border p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.runtime}</p>
            <p className={runtime ? "" : "text-[var(--amber)]"}>{runtime ? p.runtimeSummary(runtime.provider, runtime.model, runtime.temperature, runtime.maxOutputTokens) : p.runtimeMissing}</p>
          </div>
        </>, p.methodHint)}
        {section(p.schedule, <div className="grid gap-4 sm:grid-cols-2">
          {(["capacity", "delayHours"] as const).map((key) => (
            <label key={key} className="block space-y-2 text-sm font-medium" htmlFor={"study-long-" + key}>
              <span>{key === "capacity" ? p.capacity : p.delay}</span>
              <input id={"study-long-" + key} name={"long-" + key} className={control + " font-normal"} type="number" step={1}
                min={key === "capacity" ? 2 : 0} max={key === "capacity" ? 100 : 2160} value={Number.isFinite(draft[key]) ? draft[key] : ""}
                onChange={(e) => { setDraft({ ...draft, [key]: e.target.value === "" ? NaN : Number(e.target.value) }); setConfirmed(false); }} />
              <span className={studyNote + " block font-normal"}>{key === "capacity" ? p.capacityHint : p.delayHint}</span>
            </label>
          ))}
        </div>)}
        {section(p.rounds, <>
          {draft.rounds.map((round, i) => (
            <details key={i} open={i === 0} className="rounded-lg border border-border p-4">
              <summary className="min-h-11 cursor-pointer rounded py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{roundLabel(i)}</summary>
              <div className="space-y-4 pt-2">
                {(["before", "coaching", "after", "reference"] as const).map((key) => (
                  <StudyTextField key={key} name={`round-${i}-${key}`} label={p[key]} value={round[key]} max={4000} multiline
                    onChange={(v) => { setDraft({ ...draft, rounds: draft.rounds.map((x, j) => (j === i ? { ...x, [key]: v } : x)) }); setConfirmed(false); }} />
                ))}
                <p className={studyNote}>{p.referenceHint}</p>
                {i < draft.rounds.length - 1 ? (
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
                    <input type="checkbox" className={check} checked={round.updateAllowed}
                      onChange={(e) => { setDraft({ ...draft, rounds: draft.rounds.map((x, j) => (j === i ? { ...x, updateAllowed: e.target.checked } : x)) }); setConfirmed(false); }} />
                    <span>{p.updateAllowed}</span>
                  </label>
                ) : <p className={studyNote}>{p.finalRound}</p>}
              </div>
            </details>
          ))}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" className="min-h-11" disabled={draft.rounds.length >= 6} onClick={() => setDraft({ ...draft, rounds: [...draft.rounds.map((r, i) => (i === draft.rounds.length - 1 ? r : r)), blankRound()] })}>{p.addRound}</Button>
            <Button type="button" variant="ghost" className="min-h-11" disabled={draft.rounds.length <= 2}
              onClick={() => setDraft({ ...draft, rounds: draft.rounds.slice(0, -1).map((r, i) => (i === draft.rounds.length - 2 ? { ...r, updateAllowed: false } : r)) })}>{p.removeRound}</Button>
          </div>
        </>)}
        {section(p.scoring, field("rubric", p.rubric), p.rubricHint)}
        {section(p.review, <>{field("reviewedBy", p.reviewedBy, 80, false)}{field("reviewNote", p.reviewNote, 2000)}</>)}
        <section className="space-y-4 border-t border-border pt-5">
          {missing.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">{p.missing} · {missing.length}</h3>
              <ul className="flex flex-wrap gap-2">{missing.map((item) => (
                <li key={item.field}><Button type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" onClick={() => focusField(item.field)}>{item.label}</Button></li>
              ))}</ul>
            </div>
          ) : <p className={studyNote}>{p.ready}</p>}
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
            <input type="checkbox" name="confirm-freeze" className={check} checked={confirmed} disabled={!!missing.length} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{p.confirm}</span>
          </label>
          <Button type="submit" className="min-h-11 h-auto whitespace-normal" disabled={busy || !!missing.length || !confirmed}>{busy ? p.freezing : p.freeze}</Button>
        </section>
      </fieldset>
    </form>
  );
}
