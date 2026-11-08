'use client';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { announceLearningUpdate, learningErrorMessage, learningRequest } from './learning-client';

export default function EchoLearningStartButton({ cardId, enabled }: { cardId: string; enabled: boolean }) {
  const { t } = useLocale();
  const router = useRouter();
  const p = t.echoLearning;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const hintId = useId();
  async function start() {
    if (!enabled || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const { loop } = await learningRequest({ cardId }, 'POST');
      if (!loop) throw new Error('Missing record');
      announceLearningUpdate(loop, true);
      const panel = document.getElementById('echo-learning');
      if (panel) panel.scrollIntoView({ block: 'start' });
      else router.push('/echo/learning?learning=' + encodeURIComponent(loop.id));
    } catch (err) { setError(learningErrorMessage(err, p)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return (
    <div>
      <Button className="min-h-11" variant="outline" size="sm" disabled={!enabled || busy} onClick={() => void start()} aria-describedby={!enabled ? hintId : undefined}>
        <ArrowUpRight size={14} aria-hidden />{busy ? p.starting : p.start}
      </Button>
      {!enabled ? <p id={hintId} className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{p.evidenceRequired}</p> : null}
      {error ? <p className="mt-2 text-sm text-error" role="alert">{error}</p> : null}
    </div>
  );
}
