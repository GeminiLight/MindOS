'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import GithubSlugger from 'github-slugger';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';

interface Heading {
  id: string;
  text: string;
  level: number;
}

function parseHeadings(content: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  let inCodeBlock = false;

  for (let start = 0; start <= content.length;) {
    let end = content.indexOf('\n', start);
    if (end === -1) end = content.length;
    const line = content.charCodeAt(end - 1) === 13
      ? content.slice(start, end - 1)
      : content.slice(start, end);

    const fenceChar = line[0];
    if ((fenceChar === '`' || fenceChar === '~') && line.length >= 3) {
      let fenceLen = 0;
      while (line[fenceLen] === fenceChar) fenceLen += 1;
      if (fenceLen >= 3) {
        inCodeBlock = !inCodeBlock;
        start = end + 1;
        continue;
      }
    }

    if (!inCodeBlock && line[0] === '#') {
      let level = 0;
      while (level < 4 && line[level] === '#') level += 1;
      const next = line[level];
      if (level > 0 && (next === ' ' || next === '\t')) {
        const text = line.slice(level).trim();
        if (text) {
          const id = slugger.slug(text);
          headings.push({ id, text, level });
        }
      }
    }

    if (end === content.length) break;
    start = end + 1;
  }

  return headings;
}

export function hasTableOfContents(content: string): boolean {
  return parseHeadings(content).length >= 2;
}

const VIEW_HEADER_FALLBACK_H = 40;
const VIEW_HEADER_CSS_VAR = 'var(--workspace-header-h)';
const NAV_W = 212;
export const TOC_COLLAPSED_KEY = 'mindos.toc.collapsed';
export const TOC_COLLAPSED_EVENT = 'mindos:toc-collapsed-change';

export function readTableOfContentsCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TOC_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function subscribeTableOfContentsCollapsed(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const sync = () => callback();
  window.addEventListener('storage', sync);
  window.addEventListener(TOC_COLLAPSED_EVENT, sync);
  return () => {
    window.removeEventListener('storage', sync);
    window.removeEventListener(TOC_COLLAPSED_EVENT, sync);
  };
}

// Desktop has a fixed titlebar row above the view header (wiki/41 rule 10).
// Read var(--app-titlebar-h) at runtime so JS scroll math stays in sync with CSS.
function titlebarOffset(): number {
  if (typeof document === 'undefined') return 0;
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--app-titlebar-h'), 10) || 0;
}

function viewHeaderHeight(): number {
  if (typeof document === 'undefined') return VIEW_HEADER_FALLBACK_H;
  const topbar = document.querySelector<HTMLElement>('.view-page-topbar');
  const measured = topbar ? Math.round(topbar.getBoundingClientRect().height) : 0;
  if (measured > 0) return measured;
  return titlebarOffset() || VIEW_HEADER_FALLBACK_H;
}

function scrollOffset(): number {
  return titlebarOffset() + viewHeaderHeight() + 12;
}

/**
 * Find the content heading elements in the DOM by index.
 *
 * We cannot rely on id matching because three different slug algorithms exist:
 * - TOC uses github-slugger on markdown source text
 * - View mode uses rehype-slug (github-slugger on HTML text content)
 * - Edit mode uses Milkdown's defaultHeadingIdGenerator (simple toLowerCase + replace)
 *
 * Instead, we find headings by scanning visible content containers in order.
 */
function findHeadingElements(headings: Heading[]): (HTMLElement | null)[] {
  if (headings.length === 0) return [];

  // Check both .prose (View mode) and .ProseMirror (Edit mode) containers
  const containers = [
    ...document.querySelectorAll<HTMLElement>('.prose'),
    ...document.querySelectorAll<HTMLElement>('.ProseMirror'),
  ];

  for (const container of containers) {
    // Skip hidden containers (display:none from mode toggle)
    // Walk up to check if any ancestor is hidden
    let hidden = false;
    let node: HTMLElement | null = container;
    while (node) {
      if (node.style.display === 'none') { hidden = true; break; }
      node = node.parentElement;
    }
    if (hidden) continue;

    // Get content headings — in ProseMirror they are direct children
    const found = container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
    // Filter out headings that are inside Crepe UI components (not content)
    const contentHeadings = Array.from(found).filter(h => {
      // Skip headings inside toolbar, menu, or code-block UI
      return !h.closest('.milkdown-code-block, .milkdown-toolbar, .language-picker, [role="toolbar"], [role="menu"]');
    });

    if (contentHeadings.length > 0) {
      return headings.map((_, i) => contentHeadings[i] ?? null);
    }
  }

  return headings.map(() => null);
}

function findHeadingElementById(heading: Heading | undefined): HTMLElement | null {
  if (!heading?.id) return null;
  return document.getElementById(heading.id);
}

interface TableOfContentsProps {
  content: string;
}

export default function TableOfContents({ content }: TableOfContentsProps) {
  const { t } = useLocale();
  const { headings, minLevel } = useMemo(() => {
    const h = parseHeadings(content);
    return { headings: h, minLevel: h.length > 0 ? Math.min(...h.map(x => x.level)) : 1 };
  }, [content]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [collapsed, setCollapsed] = useState(readTableOfContentsCollapsed);

  useEffect(() => {
    return subscribeTableOfContentsCollapsed(() => setCollapsed(readTableOfContentsCollapsed()));
  }, []);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const linkRefs = useRef<Map<number, HTMLAnchorElement>>(new Map());
  // Cache heading elements for the current content
  const headingElsRef = useRef<(HTMLElement | null)[]>([]);

  const scrollActiveIntoView = useCallback((idx: number) => {
    const link = linkRefs.current.get(idx);
    const nav = navRef.current;
    if (!link || !nav || !link.isConnected) return;
    const navRect = nav.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const isAbove = linkRect.top < navRect.top + 40;
    const isBelow = linkRect.bottom > navRect.bottom - 40;
    if (isAbove || isBelow) {
      link.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }, []);

  const handleCollapsedToggle = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(TOC_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Keep the in-memory toggle responsive even when storage is unavailable.
    }
    window.dispatchEvent(new Event(TOC_COLLAPSED_EVENT));
  }, [collapsed]);

  // Set up IntersectionObserver to track which heading is visible
  useEffect(() => {
    if (headings.length === 0) return;
    const timer = setTimeout(() => {
      const els = findHeadingElements(headings);
      headingElsRef.current = els;
      const validEls = els.filter(Boolean) as HTMLElement[];
      if (validEls.length === 0) return;

      observerRef.current?.disconnect();
      observerRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              // Find index by element reference, not by id
              const idx = els.indexOf(entry.target as HTMLElement);
              if (idx >= 0) {
                setActiveIdx(idx);
                scrollActiveIntoView(idx);
              }
              break;
            }
          }
        },
        { rootMargin: `-${scrollOffset()}px 0% -70% 0%`, threshold: 0 }
      );
      validEls.forEach(el => observerRef.current?.observe(el));
    }, 300);
    return () => { clearTimeout(timer); observerRef.current?.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headings]);

  if (headings.length < 2) return null;

  const handleClick = (e: React.MouseEvent, idx: number) => {
    // Re-find elements in case DOM changed since observer setup
    const els = findHeadingElements(headings);
    headingElsRef.current = els;
    const el = els[idx] ?? findHeadingElementById(headings[idx]);
    if (!el) {
      setActiveIdx(idx);
      return;
    }
    e.preventDefault();
    const top = el.getBoundingClientRect().top + window.scrollY - scrollOffset();
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveIdx(idx);
  };

  return (
    <aside
      className={cn(
        'hidden xl:flex min-w-0 flex-col z-app-sticky overflow-visible',
        collapsed
          ? 'absolute right-0 top-0 h-8 w-0'
          : 'self-start sticky relative',
      )}
      data-markdown-toc-panel
      style={{
        ...(collapsed
          ? {}
          : {
              top: `calc(var(--app-titlebar-h) + ${VIEW_HEADER_CSS_VAR} + 24px)`,
              maxHeight: `calc(100vh - var(--app-titlebar-h) - ${VIEW_HEADER_CSS_VAR} - 48px)`,
              width: NAV_W,
            }),
      }}
    >
      <button
        type="button"
        onClick={handleCollapsedToggle}
        className={cn(
          'absolute top-0 z-10 flex h-8 items-center justify-center border border-border bg-background text-muted-foreground/60 transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          collapsed
            ? 'right-0 w-7 rounded-md shadow-sm'
            : '-left-5 w-5 rounded-l-md border-r-0',
        )}
        title={collapsed ? t.view.tocExpand : t.view.tocCollapse}
        aria-label={collapsed ? t.view.tocExpand : t.view.tocCollapse}
        aria-expanded={!collapsed}
        data-markdown-toc-toggle
      >
        <ChevronRight
          size={11}
          className="transition-transform duration-200"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      <nav
        ref={navRef}
        aria-label={t.view.tocTitle}
        className={cn(
          'flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1 pb-5 pl-2 pr-3 border-l border-border bg-background/95 transition-opacity duration-150',
          collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
        style={{ background: 'var(--background)' }}
        aria-hidden={collapsed}
      >
        {headings.map((heading, i) => {
          const indent = (heading.level - minLevel) * 14;
          const isActive = activeIdx === i;
          const isNested = heading.level > minLevel;
          return (
            <a
              key={`${heading.id}-${i}`}
              ref={el => {
                if (el) linkRefs.current.set(i, el);
                else linkRefs.current.delete(i);
              }}
              href={`#${heading.id}`}
              onClick={(e) => handleClick(e, i)}
              className={cn(
                'block text-xs py-1 rounded transition-colors duration-100 leading-snug shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                isActive && 'font-medium',
              )}
              style={{
                paddingLeft: `${8 + indent}px`,
                paddingRight: '8px',
                borderLeft: '2px solid',
                borderLeftColor: isActive
                  ? 'var(--amber)'
                  : isNested
                    ? 'var(--border)'
                    : 'transparent',
                marginLeft: isNested ? '7px' : '0',
                ...(isActive
                  ? { color: 'var(--amber)', background: 'var(--amber-dim)' }
                  : { color: 'var(--muted-foreground)' }
                ),
              }}
              title={heading.text}
            >
              <span className="block truncate" suppressHydrationWarning>
                {heading.text}
              </span>
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
