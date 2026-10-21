'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { ECHO_CARDS_UPDATED_EVENT } from '@/lib/echo-card-events';
import { useLocale } from '@/lib/stores/locale-store';
import { useVisiblePolling } from '@/lib/use-visible-polling';

type EchoCardSchedulerSegment = 'imprint' | 'insight' | 'promotion';

const ECHO_CARD_SCHEDULER_INTERVAL_MS = 60_000;
const ECHO_CARD_SCHEDULER_SEGMENTS: EchoCardSchedulerSegment[] = ['imprint', 'insight', 'promotion'];

type EchoCardsStatusResponse = {
  state?: {
    schedule?: {
      due?: boolean;
    };
  };
};

export default function EchoCardSchedulerInit() {
  const { locale } = useLocale();
  const pathname=usePathname()??'';
  const paused=pathname==='/echo/replay'||pathname.startsWith('/echo/replay/');
  const pausedRef=useRef(paused);
  useEffect(()=>{pausedRef.current=paused;return()=>{pausedRef.current=true;};},[paused]);
  const tickInFlightRef = useRef(false);
  const segmentInFlightRef = useRef<Set<EchoCardSchedulerSegment>>(new Set());

  async function runScheduledEchoCards() {
    if (tickInFlightRef.current||pausedRef.current) return;
    tickInFlightRef.current = true;
    try {
      for (const segment of ECHO_CARD_SCHEDULER_SEGMENTS) {
        if(pausedRef.current)break;
        await runSegmentIfDue(segment);
      }
    } finally {
      tickInFlightRef.current = false;
    }
  }

  async function runSegmentIfDue(segment: EchoCardSchedulerSegment) {
    if (segmentInFlightRef.current.has(segment)) return;
    segmentInFlightRef.current.add(segment);
    try {
      const statusResponse = await fetch(`/api/echo/cards?segment=${segment}`, { cache: 'no-store' });
      if (!statusResponse.ok) return;
      const status = await statusResponse.json() as EchoCardsStatusResponse;
      if(pausedRef.current)return;
      if (status.state?.schedule?.due !== true) return;

      const generateResponse = await fetch('/api/echo/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment, trigger: 'auto', locale }),
      });
      if (!generateResponse.ok) return;
      window.dispatchEvent(new CustomEvent(ECHO_CARDS_UPDATED_EVENT, {
        detail: { segment },
      }));
    } catch {
      // Echo scheduling is opportunistic; the next visible tick catches up.
    } finally {
      segmentInFlightRef.current.delete(segment);
    }
  }

  // Card generation is opportunistic; replay keeps its reading task in front.
  useVisiblePolling(() => {
    void runScheduledEchoCards();
  }, ECHO_CARD_SCHEDULER_INTERVAL_MS,{enabled:!paused});

  return null;
}
