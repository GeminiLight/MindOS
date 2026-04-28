'use client';

import { useState, useCallback, useRef } from 'react';
import { Copy, Check, PenLine, RotateCcw } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import ActionTooltip from './ActionTooltip';

interface UserMessageActionsProps {
  content: string;
  isLastUserMessage: boolean;
  isLoading: boolean;
  onEdit?: () => void;
  onResend?: () => void;
  labels: {
    copy: string;
    edit: string;
    regenerate: string;
  };
}

/**
 * Hover action buttons for user message bubbles.
 * - Copy: always visible
 * - Edit + Resend: only on the last user message
 * Desktop: fade-in on hover; Mobile: always visible.
 */
export default function UserMessageActions({
  content,
  isLastUserMessage,
  isLoading,
  onEdit,
  onResend,
  labels,
}: UserMessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const resendCooldownRef = useRef(false);

  const handleCopy = useCallback(() => {
    copyToClipboard(content).then(ok => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [content]);

  const handleResend = useCallback(() => {
    if (resendCooldownRef.current || isLoading) return;
    resendCooldownRef.current = true;
    setTimeout(() => { resendCooldownRef.current = false; }, 300);
    onResend?.();
  }, [onResend, isLoading]);

  const btnBase = 'p-1 rounded-md bg-card border border-border/60 shadow-sm text-muted-foreground transition-colors';

  return (
    <div className="absolute -bottom-1 left-1 z-10 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
      {/* Copy */}
      <ActionTooltip label={labels.copy}>
        <button
          type="button"
          onClick={handleCopy}
          className={`${btnBase} hover:text-foreground`}
        >
          {copied
            ? <Check size={11} className="text-success" />
            : <Copy size={11} />}
        </button>
      </ActionTooltip>

      {/* Edit — last user message only, not during streaming */}
      {isLastUserMessage && !isLoading && onEdit && (
        <ActionTooltip label={labels.edit}>
          <button
            type="button"
            onClick={onEdit}
            className={`${btnBase} hover:text-foreground`}
          >
            <PenLine size={11} />
          </button>
        </ActionTooltip>
      )}

      {/* Resend / Regenerate — last user message only, not during streaming */}
      {isLastUserMessage && !isLoading && onResend && (
        <ActionTooltip label={labels.regenerate}>
          <button
            type="button"
            onClick={handleResend}
            className={`${btnBase} hover:text-[var(--amber)]`}
          >
            <RotateCcw size={11} />
          </button>
        </ActionTooltip>
      )}
    </div>
  );
}
