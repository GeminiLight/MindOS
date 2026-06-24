'use client';

import { useMemo } from 'react';
import { Wand2, X } from 'lucide-react';
import { buildLineDiff, collapseDiffContext } from '@/components/changes/line-diff';
import type { DiffRow } from '@/components/changes/line-diff';
import type {
  ObsidianLinterAdapterRuleId,
  ObsidianLinterAppliedFixSummary,
} from '@/lib/obsidian-compat/linter-adapter';

const DIFF_LINE_LIMIT = 600;
const VISIBLE_DIFF_ROWS = 18;

const RULE_LABELS: Record<ObsidianLinterAdapterRuleId, string> = {
  'heading-space': 'heading spacing',
  'trailing-whitespace': 'trailing whitespace',
  'hard-tab': 'hard tabs',
  'multiple-blank-lines': 'blank lines',
  'missing-final-newline': 'final newline',
};

interface LinterFixReviewPanelProps {
  beforeMarkdown: string;
  afterMarkdown: string;
  applied: ObsidianLinterAppliedFixSummary[];
  fixCount: number;
  onApply: () => void;
  onClose: () => void;
}

interface LinterFixDiffPreview {
  rows: DiffRow[];
  changedRowCount: number;
  skipped: boolean;
}

export default function LinterFixReviewPanel({
  beforeMarkdown,
  afterMarkdown,
  applied,
  fixCount,
  onApply,
  onClose,
}: LinterFixReviewPanelProps) {
  const diffPreview = useMemo<LinterFixDiffPreview>(() => {
    const beforeLineCount = beforeMarkdown.split('\n').length;
    const afterLineCount = afterMarkdown.split('\n').length;
    if (beforeLineCount > DIFF_LINE_LIMIT || afterLineCount > DIFF_LINE_LIMIT) {
      return { rows: [], changedRowCount: 0, skipped: true };
    }

    const diffRows = buildLineDiff(beforeMarkdown, afterMarkdown);
    return {
      rows: collapseDiffContext(diffRows, 1),
      changedRowCount: diffRows.filter((row) => row.type !== 'equal').length,
      skipped: false,
    };
  }, [afterMarkdown, beforeMarkdown]);

  const visibleRows = diffPreview.rows.slice(0, VISIBLE_DIFF_ROWS);
  const hiddenRowCount = Math.max(0, diffPreview.rows.length - visibleRows.length);
  const ruleSummary = applied
    .map((item) => `${RULE_LABELS[item.ruleId]} x${item.count}`)
    .join(' · ');

  return (
    <div
      className="mb-3 rounded-lg border border-border bg-card p-3 shadow-sm"
      data-testid="linter-fix-review"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground">Linter review</div>
          <div className="mt-0.5 truncate text-2xs text-muted-foreground" data-testid="linter-fix-review-summary">
            {fixCount} fix{fixCount === 1 ? '' : 'es'}
            {!diffPreview.skipped && diffPreview.changedRowCount > 0 ? ` · ${diffPreview.changedRowCount} diff row${diffPreview.changedRowCount === 1 ? '' : 's'}` : ''}
            {ruleSummary ? ` · ${ruleSummary}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label="Close Linter fix review"
            onClick={onClose}
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={13} />
          </button>
          <button
            type="button"
            aria-label="Apply reviewed Linter fixes"
            onClick={onApply}
            className="inline-flex h-7 min-w-7 items-center gap-1.5 rounded-md bg-[var(--amber)] px-2.5 text-xs font-medium text-[var(--amber-foreground)] transition-colors duration-75 hover:bg-[var(--amber)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wand2 size={13} />
            <span>Apply</span>
          </button>
        </div>
      </div>

      <div className="mt-2 max-h-44 overflow-auto rounded-md border border-border/70 bg-background font-mono text-2xs">
        {diffPreview.skipped ? (
          <div className="px-2 py-1.5 text-muted-foreground">Large diff</div>
        ) : visibleRows.length > 0 ? (
          <>
            {visibleRows.map((row, index) => (
              <DiffPreviewRow key={`${row.type}-${index}`} row={row} />
            ))}
            {hiddenRowCount > 0 && (
              <div className="px-2 py-1 text-muted-foreground">... {hiddenRowCount} more</div>
            )}
          </>
        ) : (
          <div className="px-2 py-1.5 text-muted-foreground">No text diff</div>
        )}
      </div>
    </div>
  );
}

function DiffPreviewRow({ row }: { row: DiffRow }) {
  if (row.type === 'gap') {
    return <div className="px-2 py-1 text-muted-foreground">... {row.count} unchanged</div>;
  }

  const prefix = row.type === 'insert' ? '+' : row.type === 'delete' ? '-' : ' ';
  const toneClass = row.type === 'insert'
    ? 'bg-success/10 text-success'
    : row.type === 'delete'
      ? 'bg-error/10 text-error'
      : 'text-muted-foreground';

  return (
    <div className={`flex min-h-6 items-start gap-2 px-2 py-1 ${toneClass}`} data-diff-type={row.type}>
      <span className="w-3 shrink-0 select-none text-center">{prefix}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{row.text || ' '}</span>
    </div>
  );
}
