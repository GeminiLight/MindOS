'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BookmarkPlus, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';

export default function EchoCorrectionButton({ sessionId, messageIndex, text }: { sessionId: string; messageIndex: number; text: string }) {
  const { t } = useLocale(); const p = t.echoLearning; const j = p.joint;
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState({ sessionId, messageIndex, text });
  const [behavior, setBehavior] = useState(''); const [scope, setScope] = useState(''); const [check, setCheck] = useState('');
  const [saved, setSaved] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function save() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot.text));
      const messageHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const response = await fetch('/api/echo/corrections', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        body: JSON.stringify({ sessionId: snapshot.sessionId, messageIndex: snapshot.messageIndex, messageHash, behavior, scope, check }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.code === 'conflict' ? j.captureConflict : data.code === 'not-found' ? j.captureMissing : data.code === 'invalid' ? p.errors.invalid : p.errors.storage);
        return;
      }
      if (!data.loop?.id) throw new Error('Missing saved method');
      setSaved(data.loop.id);
    } catch { if (!controller.signal.aborted) setError(p.errors.storage); }
    finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  const field = (name: string, label: string, value: string, update: (value: string) => void) => <label className="block space-y-2">
    <span className="font-medium">{label}</span>
    <textarea name={name} required rows={2} maxLength={1600} value={value} onChange={(event) => update(event.target.value)}
      className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
  </label>;
  return <Dialog open={open} onOpenChange={(next) => { if (next && !behavior && !saved) setSnapshot({ sessionId, messageIndex, text }); setOpen(next); }}>
    <DialogTrigger render={<button type="button" aria-label={j.capture} title={j.capture}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
      {saved ? <Check size={15} aria-hidden /> : <BookmarkPlus size={15} aria-hidden />}
    </DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" showCloseButton={false}>
      <DialogTitle className="font-display pr-4 text-xl">{saved ? j.captureSaved : j.captureTitle}</DialogTitle>
      <DialogDescription className="text-sm leading-6 text-muted-foreground">{j.captureHint}</DialogDescription>
      {saved ? <div className="space-y-4" role="status">
        <p className="text-sm leading-6">{j.private}</p>
        <div className="flex flex-wrap gap-2">
          <Link href={'/echo/growth?learning=' + saved} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{j.captureReview}</Link>
          <Button className="min-h-11" variant="ghost" onClick={() => setOpen(false)}>{j.captureClose}</Button>
        </div>
      </div> : <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
        <details className="rounded-lg bg-muted/30 p-3"><summary className="min-h-11 py-3 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.source}</summary>
          <blockquote className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{snapshot.text.slice(0, 1000)}</blockquote>
        </details>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {field('correctionBehavior', j.behavior, behavior, setBehavior)}
          {field('correctionScope', j.scope, scope, setScope)}
          {field('correctionCheck', j.check, check, setCheck)}
        </fieldset>
        {error ? <p role="alert" className="text-sm leading-6 text-error">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} className="min-h-11 bg-primary text-primary-foreground">{busy ? p.saving : j.save}</Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setOpen(false)}>{j.captureClose}</Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}
