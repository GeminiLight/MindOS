'use client';

import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ReviewState = {
  status: 'pending' | 'approved' | 'rejected';
  targetPath?: string;
};

export default function EchoPromotionReviewActions({
  review,
  canReview,
  reviewing,
  error,
  approveLabel,
  rejectLabel,
  approvedLabel,
  rejectedLabel,
  assetPathLabel,
  onApprove,
  onReject,
}: {
  review?: ReviewState;
  canReview: boolean;
  reviewing: boolean;
  error?: string;
  approveLabel: string;
  rejectLabel: string;
  approvedLabel: string;
  rejectedLabel: string;
  assetPathLabel: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  if (review?.status === 'approved' || review?.status === 'rejected') {
    const approved = review.status === 'approved';
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/30 pt-3" data-testid="echo-promotion-review-state">
        <span className={approved
          ? 'rounded-full bg-[var(--success)]/10 px-2.5 py-1 font-sans text-xs font-medium text-success'
          : 'rounded-full bg-muted/60 px-2.5 py-1 font-sans text-xs font-medium text-muted-foreground'}
        >
          {approved ? approvedLabel : rejectedLabel}
        </span>
        {approved && review.targetPath ? (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={review.targetPath}>
            {assetPathLabel}: {review.targetPath}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-border/30 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="bg-[var(--amber)] text-[var(--amber-foreground)] hover:bg-[var(--amber)]/90"
          disabled={!canReview || reviewing}
          data-testid="echo-promotion-approve-button"
          onClick={onApprove}
        >
          <Check size={13} aria-hidden />
          {approveLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-error"
          disabled={reviewing}
          data-testid="echo-promotion-reject-button"
          onClick={onReject}
        >
          <X size={13} aria-hidden />
          {rejectLabel}
        </Button>
      </div>
      {error ? <p className="mt-2 font-sans text-xs text-error" role="alert">{error}</p> : null}
    </div>
  );
}
