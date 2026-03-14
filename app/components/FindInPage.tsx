'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';

interface FindInPageProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

const MARK_CLASS = 'findip-highlight';
const MARK_ACTIVE_CLASS = 'findip-active';

export default function FindInPage({ containerRef, onClose }: FindInPageProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const marksRef = useRef<HTMLElement[]>([]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clear highlights helper
  const clearHighlights = useCallback(() => {
    for (const el of marksRef.current) {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    }
    marksRef.current = [];
  }, []);

  // Search and highlight
  useEffect(() => {
    clearHighlights();
    setCurrent(0);

    const container = containerRef.current;
    if (!container || !query.trim()) return;

    const needle = query.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // Skip text nodes inside the find bar itself
        if (node.parentElement?.closest('[data-find-in-page]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    const newMarks: HTMLElement[] = [];
    for (const node of textNodes) {
      const text = node.textContent || '';
      const lower = text.toLowerCase();
      let startIdx = 0;
      const positions: number[] = [];

      while (true) {
        const idx = lower.indexOf(needle, startIdx);
        if (idx === -1) break;
        positions.push(idx);
        startIdx = idx + needle.length;
      }

      if (positions.length === 0) continue;

      // Split text node into fragments with <mark> wrappers
      const parent = node.parentNode;
      if (!parent) continue;

      const frag = document.createDocumentFragment();
      let lastEnd = 0;

      for (const pos of positions) {
        if (pos > lastEnd) {
          frag.appendChild(document.createTextNode(text.slice(lastEnd, pos)));
        }
        const mark = document.createElement('mark');
        mark.className = MARK_CLASS;
        mark.textContent = text.slice(pos, pos + needle.length);
        frag.appendChild(mark);
        newMarks.push(mark);
        lastEnd = pos + needle.length;
      }

      if (lastEnd < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastEnd)));
      }

      parent.replaceChild(frag, node);
    }

    marksRef.current = newMarks;
    setCurrent(newMarks.length > 0 ? 1 : 0);

    // Highlight first match
    if (newMarks.length > 0) {
      newMarks[0].classList.add(MARK_ACTIVE_CLASS);
      newMarks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    return () => {
      // cleanup on query change is handled by next effect run
    };
  }, [query, containerRef, clearHighlights]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearHighlights();
    };
  }, [clearHighlights]);

  const totalMarks = marksRef.current.length;

  const goTo = useCallback((index: number) => {
    const marks = marksRef.current;
    if (marks.length === 0) return;
    // Remove active from previous
    for (const m of marks) m.classList.remove(MARK_ACTIVE_CLASS);
    // Wrap around
    const wrapped = ((index - 1) % marks.length + marks.length) % marks.length;
    marks[wrapped].classList.add(MARK_ACTIVE_CLASS);
    marks[wrapped].scrollIntoView({ block: 'center', behavior: 'smooth' });
    setCurrent(wrapped + 1);
  }, []);

  const goNext = useCallback(() => goTo(current + 1), [current, goTo]);
  const goPrev = useCallback(() => goTo(current - 1), [current, goTo]);

  // Keyboard handling
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goPrev();
      else goNext();
    }
  }, [onClose, goNext, goPrev]);

  return (
    <>
      <style>{`
        mark.${MARK_CLASS} {
          background: rgba(250, 204, 21, 0.3);
          color: inherit;
          border-radius: 2px;
          padding: 0;
        }
        mark.${MARK_ACTIVE_CLASS} {
          background: rgba(250, 204, 21, 0.7);
          outline: 2px solid rgba(250, 204, 21, 0.5);
        }
      `}</style>
      <div className="sticky top-[96px] md:top-[44px] z-30 flex justify-end px-4 md:px-6 pointer-events-none" data-find-in-page>
        <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card shadow-lg">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.findInPage.placeholder}
            className="w-[180px] sm:w-[220px] px-2 py-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
          />
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 min-w-[48px] text-center font-display">
            {query.trim()
              ? totalMarks > 0
                ? t.findInPage.matchCount(current, totalMarks)
                : t.findInPage.noResults
              : ''}
          </span>
          <button
            onClick={goPrev}
            disabled={totalMarks === 0}
            className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            aria-label="Previous match"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={goNext}
            disabled={totalMarks === 0}
            className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            aria-label="Next match"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close find"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
