'use client';

/**
 * AskComposerInput — composer textarea + send/stop buttons with LOCAL input
 * state. Extracted from ChatContent so a keystroke re-renders only this small
 * component instead of the whole ChatContent tree (message list, popovers,
 * capsules).
 *
 * Value plumbing (parent stays render-stable per keystroke):
 * - reads: parent reads the current text via `valueRef` (kept in sync here),
 * - writes: parent writes via `setterRef.current?.(text)` — and `valueRef`
 *   doubles as the backing store, so a write while this component is
 *   unmounted (history view open) survives the next remount.
 */

import {
  memo,
  useEffect,
  useLayoutEffect,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { CornerDownRight, Send, StopCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Textarea auto-grows with content up to this many visible lines, then scrolls */
const TEXTAREA_MAX_VISIBLE_LINES = 8;

/** Per-element cached metrics to avoid getComputedStyle on every keystroke */
const _metricsCache = new WeakMap<HTMLTextAreaElement, { maxH: number }>();

/** Auto-size textarea height to fit content, capped at maxVisibleLines */
function syncTextareaToContent(el: HTMLTextAreaElement, maxVisibleLines: number): void {
  let cached = _metricsCache.get(el);
  if (!cached) {
    const style = getComputedStyle(el);
    const parsedLh = parseFloat(style.lineHeight);
    const parsedFs = parseFloat(style.fontSize);
    const fontSize = Number.isFinite(parsedFs) ? parsedFs : 14;
    const lineHeight = Number.isFinite(parsedLh) ? parsedLh : fontSize * 1.375;
    const pad =
      (Number.isFinite(parseFloat(style.paddingTop)) ? parseFloat(style.paddingTop) : 0) +
      (Number.isFinite(parseFloat(style.paddingBottom)) ? parseFloat(style.paddingBottom) : 0);
    const maxH = lineHeight * maxVisibleLines + pad;
    if (!Number.isFinite(maxH) || maxH <= 0) return;
    cached = { maxH };
    _metricsCache.set(el, cached);
  }
  const { maxH } = cached;
  el.style.height = 'auto';
  const contentH = el.scrollHeight;
  const next = Math.min(contentH, maxH);
  el.style.height = `${next}px`;
  el.style.overflowY = contentH > maxH ? 'auto' : 'hidden';
}

export interface AskComposerInputProps {
  visible: boolean;
  isHome: boolean;
  isLoading: boolean;
  /** loadingPhase === 'reconnecting' — stop button shows X / cancel title */
  reconnecting: boolean;
  placeholder: string;
  sendTitle: string;
  stopTitle: string;
  /** Send disabled for reasons other than empty input (uploads, runtime). */
  sendDisabledExternal: boolean;
  /** Allow sending with empty text (e.g. images attached). */
  allowEmptySend: boolean;
  iconSize: number;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  formRef: RefObject<HTMLFormElement | null>;
  /** Backing store for the input text — always kept in sync with local state. */
  valueRef: MutableRefObject<string>;
  /** Parent writes the input text through this slot (null while unmounted). */
  setterRef: MutableRefObject<((value: string) => void) | null>;
  /** When true, auto-submit the form once the (non-empty) value renders. */
  pendingAutoSubmitRef: MutableRefObject<boolean>;
  onValueChange: (value: string, cursorPos?: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: ClipboardEvent) => void;
  onStop: () => void;
}

const AskComposerInput = memo(function AskComposerInput({
  visible,
  isHome,
  isLoading,
  reconnecting,
  placeholder,
  sendTitle,
  stopTitle,
  sendDisabledExternal,
  allowEmptySend,
  iconSize,
  inputRef,
  formRef,
  valueRef,
  setterRef,
  pendingAutoSubmitRef,
  onValueChange,
  onKeyDown,
  onPaste,
  onStop,
}: AskComposerInputProps) {
  // Initialize from the backing store so the text survives unmount/remount
  // (history view toggle) and parent writes done while unmounted.
  const [value, setValue] = useState(() => valueRef.current);

  useLayoutEffect(() => {
    const setter = (next: string) => {
      valueRef.current = next;
      setValue(next);
    };
    setterRef.current = setter;
    return () => {
      if (setterRef.current === setter) setterRef.current = null;
    };
  }, [setterRef, valueRef]);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = inputRef.current;
    if (!el || !(el instanceof HTMLTextAreaElement)) return;
    syncTextareaToContent(el, TEXTAREA_MAX_VISIBLE_LINES);
    // Auto-submit after resend pre-fills input
    if (pendingAutoSubmitRef.current && value.trim()) {
      pendingAutoSubmitRef.current = false;
      formRef.current?.requestSubmit();
    }
  }, [value, isLoading, visible, inputRef, formRef, pendingAutoSubmitRef]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = () => _metricsCache.delete(el);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [inputRef]);

  return (
    <>
      <textarea
        ref={(el) => {
          inputRef.current = el;
        }}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          valueRef.current = next;
          setValue(next);
          onValueChange(next, e.target.selectionStart ?? undefined);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        rows={1}
        suppressHydrationWarning
        className={cn('min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent py-2 leading-relaxed text-foreground placeholder:text-muted-foreground/50 outline-none focus-visible:ring-0', isHome ? 'text-xs' : 'text-sm')}
      />

      {isLoading ? (
        <>
          {(value.trim() || allowEmptySend) && (
            <button type="submit" title={sendTitle} aria-label={sendTitle} disabled={sendDisabledExternal || (!value.trim() && !allowEmptySend)} className="hit-target-box p-2 disabled:opacity-20 disabled:scale-95 disabled:cursor-not-allowed transition-all duration-150 shrink-0 text-[var(--amber)] active:scale-95 [--hit-target-bg:color-mix(in_srgb,var(--amber)_10%,transparent)] [--hit-target-hover-bg:color-mix(in_srgb,var(--amber)_16%,transparent)] [--hit-target-radius:var(--radius-xl)]">
              <CornerDownRight size={14} />
            </button>
          )}
          <button type="button" onClick={onStop} className="hit-target-box p-2 transition-colors shrink-0 text-foreground [--hit-target-bg:var(--muted)] [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_80%,transparent)] [--hit-target-radius:var(--radius-xl)]" title={stopTitle} aria-label={stopTitle}>
            {reconnecting ? <X size={iconSize} /> : <StopCircle size={iconSize} />}
          </button>
        </>
      ) : (
        <button type="submit" title={sendTitle} aria-label={sendTitle} disabled={sendDisabledExternal || (!value.trim() && !allowEmptySend)} className="hit-target-box p-2 disabled:opacity-20 disabled:scale-95 disabled:cursor-not-allowed transition-all duration-150 shrink-0 text-[var(--amber-foreground)] active:scale-95 [--hit-target-bg:var(--amber)] [--hit-target-hover-bg:var(--amber)] [--hit-target-radius:var(--radius-xl)] [--hit-target-shadow:0_1px_2px_0_color-mix(in_srgb,var(--amber)_15%,transparent)] [--hit-target-hover-shadow:0_4px_6px_-1px_color-mix(in_srgb,var(--amber)_20%,transparent)]">
          <Send size={14} />
        </button>
      )}
    </>
  );
});

export default AskComposerInput;
