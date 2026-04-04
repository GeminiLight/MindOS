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

const TOPBAR_H = 44;
const SCROLL_OFFSET = TOPBAR_H + 12;
const NAV_W = 212;

interface TableOfContentsProps {
  content: string;
}

export default function TableOfContents({ content }: TableOfContentsProps) {
  const { t } = useLocale();
  const { headings, minLevel } = useMemo(() => {
    const h = parseHeadings(content);
    return { headings: h, minLevel: h.length > 0 ? Math.min(...h.map(x => x.level)) : 1 };
  }, [content]);
  const [activeId, setActiveId] = useState<string>('');
  const [collapsed, setCollapsed] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const scrollActiveIntoView = useCallback((id: string) => {
    const link = linkRefs.current.get(id);
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

  useEffect(() => {
    if (headings.length === 0) return;
    const timer = setTimeout(() => {
      const elements = headings
        .map(h => document.getElementById(h.id))
        .filter(Boolean) as HTMLElement[];
      if (elements.length === 0) return;
      observerRef.current?.disconnect();
      observerRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              setActiveId(entry.target.id);
              scrollActiveIntoView(entry.target.id);
              break;
            }
          }
        },
        { rootMargin: `-${SCROLL_OFFSET}px 0% -70% 0%`, threshold: 0 }
      );
      elements.forEach(el => observerRef.current?.observe(el));
    }, 150);
    return () => { clearTimeout(timer); observerRef.current?.disconnect(); };
  // headings is derived from content via useMemo; scrollActiveIntoView is stable (no deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headings]);

  if (headings.length < 2) return null;

  const handleClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveId(id);
  };

  return (
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
      {/* Collapse / expand toggle */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="absolute top-6 flex items-center justify-center w-5 h-8 rounded-l-md border border-r-0 border-border hover:bg-muted transition-colors"
        style={{
          left: -20,
          background: 'var(--background)',
        }}
        title={collapsed ? t.view.tocExpand : t.view.tocCollapse}
      >
        <ChevronRight
          size={11}
          className="text-muted-foreground/60 transition-transform duration-200"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Scrollable nav list — min-h-0 enables flex child to shrink & scroll */}
      <nav
        ref={navRef}
        aria-label={t.view.tocTitle}
        className="flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1 py-5 pl-2 pr-3 border-l border-border"
        style={{ background: 'var(--background)' }}
      >
        <p
          className="text-2xs font-semibold uppercase tracking-wider px-2 mb-1 text-muted-foreground/50 shrink-0"
        >
          {t.view.tocTitle}
        </p>
        {headings.map((heading, i) => {
          const indent = (heading.level - minLevel) * 14;
          const isActive = activeId === heading.id;
          const isNested = heading.level > minLevel;
          return (
            <a
              key={`${heading.id}-${i}`}
              ref={el => {
                if (el) linkRefs.current.set(heading.id, el);
                else linkRefs.current.delete(heading.id);
              }}
              href={`#${heading.id}`}
              onClick={(e) => handleClick(e, heading.id)}
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
              <span className="line-clamp-2" suppressHydrationWarning>
                {heading.text}
              </span>
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
