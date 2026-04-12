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
  const lines = content.split('\n');
  const headings: Heading[] = [];
  let inCodeBlock = false;
  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(/^(#{1,4})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = slugger.slug(text);
      headings.push({ id, text, level });
    }
  }
  return headings;
}

const TOPBAR_H = 46;
const SCROLL_OFFSET = TOPBAR_H + 12;
const NAV_W = 212;

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
  const [collapsed, setCollapsed] = useState(false);

  // Broadcast TOC width to content area via CSS variables
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--toc-width', collapsed ? '0px' : `${NAV_W}px`);
    if (collapsed) {
      root.removeProperty('--toc-margin');
    } else {
      root.setProperty('--toc-margin', `${NAV_W + 8}px`);
    }
    return () => { root.removeProperty('--toc-width'); root.removeProperty('--toc-margin'); };
  }, [collapsed]);
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
        { rootMargin: `-${SCROLL_OFFSET}px 0% -70% 0%`, threshold: 0 }
      );
      validEls.forEach(el => observerRef.current?.observe(el));
    }, 300);
    return () => { clearTimeout(timer); observerRef.current?.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headings]);

  if (headings.length < 2) return null;

  const handleClick = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    // Re-find elements in case DOM changed since observer setup
    const els = findHeadingElements(headings);
    headingElsRef.current = els;
    const el = els[idx];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveIdx(idx);
  };

  return (
    <>
      {/* Collapse / expand toggle — separate from aside so it stays visible */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="hidden xl:flex fixed z-10 top-[46px] flex items-center justify-center w-5 h-8 rounded-l-md border border-r-0 border-border hover:bg-muted transition-colors"
        style={{
          right: `calc(var(--right-panel-width, 0px) + ${collapsed ? 0 : NAV_W}px)`,
          background: 'var(--background)',
          transition: 'right 200ms ease-in-out',
        }}
        title={collapsed ? t.view.tocExpand : t.view.tocCollapse}
      >
        <ChevronRight
          size={11}
          className="text-muted-foreground/60 transition-transform duration-200"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* TOC panel */}
      <aside
        className="hidden xl:flex flex-col fixed z-10 overflow-hidden"
        style={{
          top: TOPBAR_H,
          height: `calc(100vh - ${TOPBAR_H}px)`,
          width: NAV_W,
          right: 'var(--right-panel-width, 0px)',
          transform: collapsed ? `translateX(${NAV_W}px)` : 'translateX(0)',
          transition: 'transform 200ms ease-in-out, right 200ms ease-out',
        }}
      >
      <div className="flex items-center h-[46px] px-4 border-l border-b border-border" style={{ background: 'var(--background)' }}>
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/55 shrink-0">
          {t.view.tocTitle}
        </p>
      </div>
      <nav
        ref={navRef}
        aria-label={t.view.tocTitle}
        className="flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1 pt-3 pb-5 pl-2 pr-3 border-l border-border"
        style={{ background: 'var(--background)' }}
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
    </>
  );
}
