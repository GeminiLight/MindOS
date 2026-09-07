'use client';
import { useEffect, useRef, useState } from 'react';
import type { StudyReviewAccessView } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { NarrowPageShell } from '@/components/shared/ContentPageShell';
import { readStudyInvitationFragment } from '@/lib/study-invitation-fragment';
import { studyControl, studyNote } from './StudyFields';
import { reviewerCopy } from './reviewer-copy';
import { ReviewPacket } from './ReviewPacket';
export function ReviewerWorkspace({ studyId, locale }: { studyId: string; locale: 'en' | 'zh' }) {
  const p = reviewerCopy[locale]; const [view, setView] = useState<StudyReviewAccessView | null>(null);
  const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [acknowledged, setAcknowledged] = useState(false); const [dirty, setDirty] = useState(false);
  const controller = useRef<AbortController | null>(null); const token = useRef<string | null>(null); const initialized = useRef('');
  const heading = useRef<HTMLHeadingElement>(null);
  async function send(command?: unknown, exchange = false): Promise<StudyReviewAccessView | null> {
    if (controller.current) return null;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setSaving(!!command && !exchange); setError('');
    try {
      const response = await fetch('/api/study/review/' + studyId + (exchange ? '/session' : ''), { method: exchange ? 'POST' : command ? 'PATCH' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]), ...(command ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) } : {}) });
      const data = await response.json(); if (abort.signal.aborted) return null;
      if (!response.ok) { setError(data.code ?? 'storage'); if (data.code === 'unauthorized') setView(null); return null; }
      setView(data.view); if (exchange) token.current = null; return data.view;
    } catch { if (!abort.signal.aborted) setError('storage'); return null; }
    finally { if (controller.current === abort) { controller.current = null; if (!abort.signal.aborted) setBusy(false); } }
  }
  useEffect(() => {
    if (initialized.current !== studyId) { initialized.current = studyId; token.current = readStudyInvitationFragment(); setView(null); setAcknowledged(false); }
    void send(token.current !== null ? { token: token.current } : undefined, token.current !== null);
    return () => { controller.current?.abort(); controller.current = null; };
  }, [studyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { heading.current?.focus(); }, [view?.kind]);
  useEffect(() => { if (!dirty && !busy) return; const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave); }, [dirty, busy]);
  useEffect(() => {
    const change = () => { if (window.location.pathname.replace(/\/$/, '') !== '/study/review/' + studyId) return; const incoming = readStudyInvitationFragment(); if (incoming === null) return;
      if (busy) { setError('switch-busy'); return; } if (dirty && !window.confirm(p.discard)) return;
      token.current = incoming; setView(null); setAcknowledged(false); void send({ token: incoming }, true);
    }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, [studyId, busy, dirty, p.discard]); // eslint-disable-line react-hooks/exhaustive-deps
  async function reload() { if (busy || dirty && !window.confirm(p.discard)) return; const result = await send(token.current !== null ? { token: token.current } : undefined, token.current !== null); if (result) setPacketRevision(v => v + 1); }
  const [packetRevision, setPacketRevision] = useState(0);
  return <NarrowPageShell as="main" aria-labelledby="review-title" className="min-h-[calc(100dvh-var(--app-titlebar-h))] space-y-7">
    <header className="space-y-3"><p className={studyNote}>MindOS</p><h1 id="review-title" ref={heading} tabIndex={-1} className="rounded font-display text-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.title}</h1>{view ? <p className={studyNote}>{p.expire} · <time dateTime={view.expiresAt}>{new Date(view.expiresAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</time></p> : null}</header>
    {busy ? <p role="status" className={studyNote}>{saving && view?.kind === 'workspace' ? p.saving : p.loading}</p> : null}
    {error ? <div role="alert" className="space-y-3 border border-error rounded-lg p-4"><p className="text-sm leading-7">{error === 'unauthorized' || error === 'unavailable' ? p.unavailable : error === 'conflict' ? p.conflict : error === 'invalid' ? p.invalid : error === 'switch-busy' ? p.busySwitch : p.failed}</p></div> : null}
    {view?.kind === 'briefing' ? <section className="space-y-5"><h2 className="font-display text-xl">{p.briefing}</h2><p className="leading-7">{p.note}</p><label className="flex min-h-11 items-start gap-3 py-2 text-sm leading-6"><input name="acknowledge" type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />{p.acknowledge}</label><Button className="min-h-11" disabled={busy || !acknowledged} onClick={() => void send({ action: 'accept', accepted: true, protocolHash: view.protocolHash })}>{p.open}</Button></section> : null}
    {view?.kind === 'workspace' ? <ReviewPacket key={packetRevision} view={view} locale={locale} busy={busy} send={send} onDirty={setDirty} /> : null}
    <footer className="border-t border-border pt-5"><Button variant="outline" className={studyControl} disabled={busy} onClick={() => void reload()}>{view ? p.reload : p.retry}</Button></footer>
  </NarrowPageShell>;
}
