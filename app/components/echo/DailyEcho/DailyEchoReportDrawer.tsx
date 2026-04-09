'use client';

/**
 * Daily Echo Report Drawer
 *
 * Main UI component for displaying generated daily echo reports
 */

import { X, RotateCw } from 'lucide-react';
import type { DailyEchoReport } from '@/lib/daily-echo/types';
import { DailyEchoSnapshotSection } from './sections/DailyEchoSnapshotSection';
import { DailyEchoThemesSection } from './sections/DailyEchoThemesSection';
import { DailyEchoAlignmentSection } from './sections/DailyEchoAlignmentSection';
import { DailyEchoReflectionSection } from './sections/DailyEchoReflectionSection';

interface DailyEchoReportDrawerProps {
  isOpen: boolean;
  report: DailyEchoReport | null;
  isGenerating: boolean;
  onClose: () => void;
  onRegenerate: () => void;
  onContinueAgent: (content: string) => void;
  locale?: { t: Record<string, any> };
}

export default function DailyEchoReportDrawer({
  isOpen,
  report,
  isGenerating,
  onClose,
  onRegenerate,
  onContinueAgent,
  locale,
}: DailyEchoReportDrawerProps) {
  const t = locale?.t || {};

  // Use the existing design tokens from Echo
  const drawerClass =
    'fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col bg-background border-l border-border shadow-lg transition-transform duration-200 ease-out';

  const drawerOpenClass = isOpen ? 'translate-x-0' : 'translate-x-full';
  const overlayClass = isOpen
    ? 'fixed inset-0 z-30 bg-black/20 transition-opacity duration-200'
    : 'hidden';

  if (!isOpen && !report) {
    return null;
  }

  return (
    <>
      {/* Overlay */}
      <div
        className={overlayClass}
        onClick={onClose}
        role="presentation"
      />

      {/* Drawer */}
      <div
        className={`${drawerClass} ${drawerOpenClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-echo-drawer-title"
      >
        {/* Header */}
        <div className="sticky top-0 z-50 border-b border-border bg-background px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2
                id="daily-echo-drawer-title"
                className="text-lg font-semibold text-foreground"
              >
                {t.dailyReportTitle || '每日回响'}
              </h2>
              {report && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.dailyReportGenerated || '生成于'}{' '}
                  {new Date(
                    report.generatedAt
                  ).toLocaleTimeString()}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 hover:bg-muted transition-colors"
              aria-label="Close"
              type="button"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        {isGenerating ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="inline-flex h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-[var(--amber)] mb-4" />
              <p className="text-sm text-muted-foreground">
                {t.dailyReportGenerating ||
                  '生成中...'}
              </p>
            </div>
          </div>
        ) : report ? (
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Snapshot Section */}
            <DailyEchoSnapshotSection
              snapshot={report.snapshot}
              locale={locale}
            />

            {/* Themes Section */}
            {report.themes && report.themes.length > 0 && (
              <DailyEchoThemesSection
                themes={report.themes}
                locale={locale}
              />
            )}

            {/* Alignment Section */}
            <DailyEchoAlignmentSection
              alignment={report.alignment}
              locale={locale}
            />

            {/* Reflection Section */}
            {report.reflectionPrompts &&
              report.reflectionPrompts.prompts.length > 0 && (
                <DailyEchoReflectionSection
                  prompts={report.reflectionPrompts.prompts}
                  locale={locale}
                />
              )}
          </div>
        ) : null}

        {/* Footer */}
        {report && (
          <div className="sticky bottom-0 border-t border-border bg-background px-6 py-4 flex gap-3">
            <button
              onClick={() =>
                onContinueAgent(
                  report.alignment.analysis
                )
              }
              className="flex-1 rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--amber)]/90"
              type="button"
            >
              {t.dailyReportContinueAgent ||
                '继续与 Agent'}
            </button>
            <button
              onClick={onRegenerate}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              type="button"
              title="Regenerate report"
            >
              <RotateCw size={16} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
