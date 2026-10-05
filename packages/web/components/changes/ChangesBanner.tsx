'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { FilePenLine, History, X } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { agentReviewHref } from '@/lib/agent-review-links';
import { readDismissedAgentReviewIds, writeDismissedAgentReviewIds } from '@/lib/agent-review-reminder';
import { useAgentChangeReview } from '@/hooks/useAgentChangeReview';

function currentMindRootId(): string | undefined {
  return typeof document === 'undefined' ? undefined : document.documentElement.dataset.mindRootId;
}

export default function ChangesBanner() {
  const [dismissedAtCount, setDismissedAtCount] = useState<number | null>(null);
  const [dismissedAgentEventIds, setDismissedAgentEventIds] = useState<ReadonlySet<string>>(
    () => readDismissedAgentReviewIds(currentMindRootId()),
  );
  const [autoDismissed, setAutoDismissed] = useState(false);
  const prevUnreadRef = useRef(0);
  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const pathname = usePathname();
  const { t } = useLocale();
  const review = useAgentChangeReview();
  const hasAgentReview = review.unreadAgentCount > 0;
  const compactHomeReview = hasAgentReview && pathname === '/';
  const hasNewAgentReview = review.unreviewedEvents.some(event => !dismissedAgentEventIds.has(event.id));
  const activeUnreadCount = hasAgentReview ? review.unreadAgentCount : review.unreadCount;
  const reviewHref = hasAgentReview ? agentReviewHref() : '/changelog';
  const notice = hasAgentReview
    ? {
        title: t.changes.agentReviewNoticeTitle(review.unreviewedPathCount),
        description: t.changes.agentReviewNoticeMeta(review.unreadAgentCount),
        action: t.changes.reviewAgentChanges,
        Icon: FilePenLine,
      }
    : {
        title: t.changes.activityNoticeTitle(activeUnreadCount),
        description: t.changes.activityNoticeMeta,
        action: t.changes.viewActivity,
        Icon: History,
      };

  // Re-show banner when new changes arrive after auto-dismiss
  useEffect(() => {
    if (activeUnreadCount > prevUnreadRef.current && autoDismissed) {
      setAutoDismissed(false);
    }
    prevUnreadRef.current = activeUnreadCount;
  }, [activeUnreadCount, autoDismissed]);

  const shouldShow = useMemo(() => {
    if (activeUnreadCount <= 0) return false;
    if (pathname?.startsWith('/changes') || pathname?.startsWith('/changelog')) return false;
    if (hasAgentReview) return hasNewAgentReview;
    if (dismissedAtCount !== null && activeUnreadCount <= dismissedAtCount) return false;
    if (autoDismissed) return false;
    return true;
  }, [activeUnreadCount, dismissedAtCount, pathname, autoDismissed, hasAgentReview, hasNewAgentReview]);

  const dismissNotice = () => {
    if (!hasAgentReview) {
      setDismissedAtCount(activeUnreadCount);
      return;
    }
    const ids = review.unreviewedEvents.map(event => event.id);
    setDismissedAgentEventIds(new Set(ids));
    writeDismissedAgentReviewIds(ids, currentMindRootId());
  };

  // Ordinary activity is a light notification; agent edits are a review task.
  useEffect(() => {
    if (!shouldShow || hasAgentReview) return;
    const timer = setTimeout(() => setAutoDismissed(true), 10_000);
    return () => clearTimeout(timer);
  }, [hasAgentReview, shouldShow]);

  useEffect(() => {
    const durationMs = 160;
    if (shouldShow) {
      setIsRendered(true);
      const raf = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setIsVisible(false);
    const timer = setTimeout(() => setIsRendered(false), durationMs);
    return () => clearTimeout(timer);
  }, [shouldShow]);

  if (!isRendered) return null;

  const Icon = notice.Icon;
  const containerClass = hasAgentReview
    ? 'relative z-app-popover mx-3 mb-2 w-auto transition-all duration-150 ease-out md:fixed md:right-6 md:top-[calc(var(--app-titlebar-h)+12px)] md:mx-0 md:mb-0 md:w-[320px]'
    : 'fixed bottom-4 right-3 z-app-popover w-[calc(100vw-24px)] max-w-[360px] transition-all duration-150 ease-out md:bottom-6 md:right-6 md:w-[360px]';

  return (
    <div
      data-changes-banner
      data-changes-banner-kind={hasAgentReview ? 'agent-review' : 'activity'}
      className={`${containerClass} ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
      }`}
    >
      <div
        className={`rounded-xl border border-border/80 bg-card px-3 shadow-sm md:shadow-md ${compactHomeReview ? 'py-0 md:py-1' : hasAgentReview ? 'py-1' : 'py-2.5'}`}
      >
        <div className={`flex gap-2.5 ${compactHomeReview ? 'items-center md:items-start' : 'items-start'}`}>
          <span
            className={`${compactHomeReview ? 'hidden md:inline-flex' : 'inline-flex'} h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
              hasAgentReview
                ? 'bg-[var(--amber-subtle)] text-[var(--amber)]'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <Icon size={15} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className={compactHomeReview ? 'flex min-w-0 flex-1 items-center gap-1 md:block' : 'min-w-0 flex-1'}>
                <p className={`text-sm font-medium leading-5 text-foreground ${compactHomeReview ? 'min-w-0 flex-1 truncate md:block md:overflow-visible md:whitespace-normal' : ''}`}>
                  {notice.title}
                </p>
                <div className={`${compactHomeReview ? 'flex shrink-0 items-center md:mt-0.5' : 'mt-0.5 flex flex-wrap items-center'} gap-x-2`}>
                  <p className={`text-xs leading-4 text-muted-foreground ${compactHomeReview ? 'hidden md:block' : ''}`}>{notice.description}</p>
                  <Link
                    href={reviewHref}
                    aria-label={hasAgentReview ? t.changes.reviewAgentChanges : undefined}
                    className="hit-target-box inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-xs font-medium text-[var(--amber-text)] underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)]"
                  >
                    {hasAgentReview ? t.changes.reviewAgentShort : notice.action}
                  </Link>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissNotice}
                aria-label={t.changes.dismiss}
                className="hit-target-box -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_60%,transparent)] [--hit-target-radius:var(--radius-md)]"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
