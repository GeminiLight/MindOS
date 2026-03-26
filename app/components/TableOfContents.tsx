'use client';

import { useEffect, useState, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import GithubSlugger from 'github-slugger';

interface Heading {
  id: string;
  text: string;
  level: number;
}

function parseHeadings(content: string): Heading[] {
  const slugger = new GithubSlugger();
  const lines = content.split('\n');
  const headings: Heading[] = [];
  for (const line of lines) {
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
  const headings = parseHeadings(content);
  const [activeId, setActiveId] = useState<string>('');
  const [collapsed, setCollapsed] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

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
            if (entry.isIntersecting) { setActiveId(entry.target.id); break; }
          }
        },
        { rootMargin: `-${SCROLL_OFFSET}px 0% -70% 0%`, threshold: 0 }
      );
      elements.forEach(el => observerRef.current?.observe(el));
    }, 150);
    return () => { clearTimeout(timer); observerRef.current?.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  if (headings.length < 2) return null;

  const minLevel = Math.min(...headings.map(h => h.level));

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
      className="hidden xl:block fixed z-10"
      style={{
        top: TOPBAR_H,
        height: `calc(100vh - ${TOPBAR_H}px)`,
        // Always reserve full width so content margin doesn't jump
        width: NAV_W,
        // Shift right when Ask AI panel is open (CSS var injected by SidebarLayout)
        right: 'var(--right-panel-width, 0px)',
        // Slide the entire panel off the right edge when collapsed
        transform: collapsed ? `translateX(${NAV_W}px)` : 'translateX(0)',
        transition: 'transform 200ms ease-in-out, right 200ms ease-out',
      }}
    >
      {/* Collapse / expand button — tab attached to left edge of the panel */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="absolute top-6 flex items-center justify-center w-5 h-8 rounded-l-md border border-r-0 border-border hover:bg-muted transition-colors"
        style={{
          left: -20,           // sticks out to the left of the panel
          background: 'var(--background)',
        }}
        title={collapsed ? 'Expand TOC' : 'Collapse TOC'}
      >
        <ChevronRight
          size={11}
          className="text-muted-foreground/60 transition-transform duration-200"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Nav list */}
      <nav
        className="flex flex-col gap-0.5 overflow-y-auto py-5 pl-2 pr-3 h-full border-l border-border"
        style={{ background: 'var(--background)' }}
      >
        <p
          className="text-2xs font-semibold uppercase tracking-wider px-2 mb-1"
          style={{ color: 'var(--muted-foreground)', opacity: 0.5 }}
        >
          On this page
        </p>
        {headings.map((heading, i) => {
          const indent = (heading.level - minLevel) * 14;
          const isActive = activeId === heading.id;
          const isNested = heading.level > minLevel;
          return (
            <a
              key={`${heading.id}-${i}`}
              href={`#${heading.id}`}
              onClick={(e) => handleClick(e, heading.id)}
              className="block text-xs py-1 rounded transition-colors duration-100 leading-snug"
              suppressHydrationWarning
              style={{
                paddingLeft: `${8 + indent}px`,
                paddingRight: '8px',
                borderLeft: isNested ? '1px solid var(--border)' : 'none',
                marginLeft: isNested ? '8px' : '0',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                ...(isActive
                  ? { color: 'var(--amber)', background: 'var(--amber-dim)' }
                  : { color: 'var(--muted-foreground)' }
                )
              }}
            >
              {heading.text}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
