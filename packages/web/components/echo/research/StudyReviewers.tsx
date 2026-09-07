'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StudyDownload } from './StudyDownload';
import { studyControl, studyNote } from './StudyFields';
import { reviewerInvitationCopy } from './reviewer-invitation-copy';

type Invitation = { id: string; reviewerId: string; label: string; expiresAt: string; status: 'active' | 'expired' | 'revoked'; accepted: boolean; itemCount: number };
type Creation = { id: string; protocolHash: string; requestId: string; label: string; expiresAt: string; reviewerId?: string };
type Payload = { invitations?: Invitation[]; availableCount?: number; invitation?: { id: string; token: string }; code?: string };
export function StudyReviewers({ studyId, protocolHash, locale }: { studyId: string; protocolHash: string; locale: 'en' | 'zh' }) {
  const p = reviewerInvitationCopy[locale];
  const [open, setOpen] = useState(false); const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [available, setAvailable] = useState(0); const [label, setLabel] = useState(''); const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [link, setLink] = useState<{ id: string; url: string } | null>(null); const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState<Creation | null>(null); const request = useRef<AbortController | null>(null);
  const validDays = Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 180;
  const canIssue = !busy && error !== 'unavailable' && invitations !== null && available > 0 && validDays;
  async function send(method = 'GET', input?: unknown): Promise<Payload | null> {
    if (request.current) return null;
    const abort = new AbortController(); request.current = abort; setBusy(true); setError('');
    try {
      const response = await fetch('/api/echo/research/reviewers' + (method === 'GET' ? '?id=' + encodeURIComponent(studyId) : ''), {
        method, cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
        ...(input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}),
      });
      const data = await response.json() as Payload;
      if (abort.signal.aborted) return null;
      if (!response.ok) { setError(data.code ?? 'storage'); return null; }
      return data;
    } catch { if (!abort.signal.aborted) setError('storage'); return null; }
    finally { if (request.current === abort) { request.current = null; if (!abort.signal.aborted) setBusy(false); } }
  }
  async function load() { const data = await send(); if (data) { setInvitations(data.invitations ?? []); setAvailable(data.availableCount ?? 0); } }
  useEffect(() => { if (open && invitations === null) void load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  async function issue(existing?: Invitation) {
    if (!canIssue || !pending && !existing && !label.trim()) return;
    const command = pending ?? { id: studyId, protocolHash, requestId: crypto.randomUUID(), label: existing?.label ?? label.trim(),
      expiresAt: new Date(Date.now() + Number(days) * 86400000).toISOString(), ...(existing ? { reviewerId: existing.reviewerId } : {}) };
    setPending(command);
    const data = await send('POST', command);
    if (!data?.invitation) return;
    setPending(null); setLink({ id: data.invitation.id, url: window.location.origin + '/study/review/' + studyId + '#invite=' + data.invitation.token }); setFeedback('');
    await load();
  }
  async function revoke(i: Invitation) {
    if (busy || pending || !window.confirm(p.confirm)) return;
    const data = await send('PATCH', { id: studyId, invitationId: i.id });
    if (data?.invitations) { setInvitations(data.invitations); if (link?.id === i.id) setLink(null); }
  }
  return <details className="border-t border-border pt-1" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer rounded py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.title}</summary>
    {open ? <div className="space-y-5 pb-4">
      <p className={studyNote}>{p.note}</p>
      {error ? <p role="alert" className="text-sm leading-7 text-error">{error === 'unavailable' ? p.protect : error === 'conflict' ? p.conflict : error === 'invalid' ? p.invalid : p.failed}</p> : null}
      {busy ? <p role="status" className={studyNote}>{p.busy}</p> : null}
      <Button variant="outline" className={studyControl} disabled={busy} onClick={() => void load()}>{p.reload}</Button>
      {invitations ? <>
        <p className={studyNote}>{available ? p.available + ' · ' + available : p.empty}</p>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void issue(); }}>
          <label className="block space-y-2 text-sm"><span>{p.label}</span><Input name="reviewerLabel" maxLength={80} value={label} disabled={busy || !!pending} onChange={e => setLabel(e.target.value)} className={studyControl} /><span className={studyNote + ' block'}>{p.labelHint}</span></label>
          <label className="block space-y-2 text-sm"><span>{p.days}</span><Input name="reviewerDays" type="number" min={1} max={180} step={1} value={days} disabled={busy || !!pending} onChange={e => setDays(e.target.value)} className={studyControl + ' max-w-52'} /></label>
          <Button type="submit" className="min-h-11" disabled={!canIssue || !pending && !label.trim()}>{pending ? p.retry : p.create}</Button>
          {pending ? <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => { if (!busy && window.confirm(p.stopConfirm)) { setPending(null); void load(); } }}>{p.stop}</Button> : null}
        </form>
        {link ? <section className="space-y-3 rounded-lg border border-border p-4">
          <p className={studyNote}>{p.privacy}</p><label className="block space-y-2 text-sm"><span>{p.link}</span><textarea name="reviewerLink" readOnly value={link.url} rows={3} className={studyControl + ' block w-full resize-none rounded-md border bg-background px-3 py-2 break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'} onFocus={e => e.target.select()} /></label>
          <Button variant="outline" className={studyControl} onClick={async () => { try { await navigator.clipboard.writeText(link.url); setFeedback(p.copied); } catch { setFeedback(p.manual); } }}>{p.copy}</Button>
          {feedback ? <p role="status" className={studyNote}>{feedback}</p> : null}<p className={studyNote}>{p.once}</p>
        </section> : null}
        {invitations.length ? <><p className={studyNote}>{p.updateHint}</p><ul className="divide-y divide-border">{invitations.map(i => <li key={i.id} className="space-y-3 py-4">
          <p className="break-words font-medium">{i.label}</p><p className={studyNote}>{p[i.status]} · {i.accepted ? p.accepted : p.unused} · {p.packet}: {i.itemCount}</p>
          <p className={studyNote}><time dateTime={i.expiresAt}>{new Date(i.expiresAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</time></p>
          <div className="flex flex-wrap gap-2"><Button variant="outline" className={studyControl + ' h-auto whitespace-normal'} disabled={!canIssue || !!pending} onClick={() => void issue(i)}>{p.update}</Button>
            {i.status !== 'revoked' ? <Button variant="ghost" className="min-h-11" disabled={busy || !!pending} aria-label={p.revoke + ' · ' + i.label} onClick={() => void revoke(i)}>{p.revoke}</Button> : null}</div>
        </li>)}</ul></> : <p className={studyNote}>{p.noInvitations}</p>}
        <StudyDownload studyId={studyId} locale={locale} />
      </> : null}
    </div> : null}
  </details>;
}
