'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Home, FileText, Table, Folder, History, MoreHorizontal } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

const FRIENDLY_PATHS: Record<string, { icon: React.ReactNode; getLabel: (t: ReturnType<typeof useLocale>['t']) => string }> = {
  '.mindos/change-log.json': { icon: <History size={13} className="text-[var(--amber)] shrink-0" />, getLabel: (t) => t.changes.title },
};

function FileTypeIcon({ name }: { name: string }) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  if (ext === '.csv') return <Table size={13} className="text-success shrink-0" />;
  if (ext) return <FileText size={13} className="text-muted-foreground shrink-0" />;
  return <Folder size={13} className="text-yellow-400 shrink-0" />;
}

export type BreadcrumbVisibility = {
  visible: number[];
  hidden: number[];
};

function estimatePartWidth(part: string, isLast: boolean): number {
  const labelWidth = Math.ceil(part.length * 6.6) + (isLast ? 42 : 28);
  const max = isLast ? 360 : 200;
  const min = isLast ? 92 : 52;
  return Math.min(max, Math.max(min, labelWidth));
}

function estimateVisibleWidth(parts: string[], visible: Set<number>): number {
  const hiddenCount = parts.length - visible.size;
  let width = 40; // home button + first separator breathing room
  for (const index of visible) {
    width += estimatePartWidth(parts[index] ?? '', index === parts.length - 1);
    width += 18; // chevron + gap
  }
  if (hiddenCount > 0) width += 42;
  return width;
}

export function computeBreadcrumbVisibility(parts: string[], containerWidth: number): BreadcrumbVisibility {
  if (parts.length <= 3) {
    return { visible: parts.map((_, index) => index), hidden: [] };
  }

  const budget = Math.max(140, Math.floor(containerWidth || 0));
  const all = new Set(parts.map((_, index) => index));
  if (containerWidth > 0 && estimateVisibleWidth(parts, all) <= budget) {
    return { visible: Array.from(all), hidden: [] };
  }

  const visible = new Set<number>([parts.length - 1]);
  const tryAdd = (index: number) => {
    if (index < 0 || index >= parts.length || visible.has(index)) return;
    const next = new Set(visible);
    next.add(index);
    if (estimateVisibleWidth(parts, next) <= budget) visible.add(index);
  };

  tryAdd(0);
  tryAdd(parts.length - 2);

  let left = 1;
  let right = parts.length - 3;
  while (left <= right) {
    const before = visible.size;
    tryAdd(left);
    if (right !== left) tryAdd(right);
    if (visible.size === before) break;
    left += 1;
    right -= 1;
  }

  const visibleIndices = Array.from(visible).sort((a, b) => a - b);
  return {
    visible: visibleIndices,
    hidden: parts.map((_, index) => index).filter(index => !visible.has(index)),
  };
}

export default function Breadcrumb({ filePath }: { filePath: string }) {
  const { t } = useLocale();
  const friendly = FRIENDLY_PATHS[filePath];
  const navRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const ellipsisRef = useRef<HTMLButtonElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const node = navRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setContainerWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || ellipsisRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const parts = useMemo(() => filePath.split('/'), [filePath]);
  const visibility = useMemo(
    () => computeBreadcrumbVisibility(parts, containerWidth),
    [parts, containerWidth],
  );

  if (friendly) {
    return (
      <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground flex-nowrap">
        <Link
          href="/"
          className="hit-target-box inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_50%,transparent)] [--hit-target-radius:var(--radius-md)]"
          title="Home"
        >
          <Home size={14} />
        </Link>
        <ChevronRight size={12} className="pointer-events-none text-muted-foreground/50 shrink-0" />
        <span className="min-w-0 inline-flex min-h-8 items-center gap-1.5 px-2 text-foreground font-medium">
          {friendly.icon}
          <span className="block truncate max-w-[180px] sm:max-w-[260px] md:max-w-[360px]">{friendly.getLabel(t)}</span>
        </span>
      </nav>
    );
  }

  const visible = new Set(visibility.visible);
  const hidden = new Set(visibility.hidden);
  let ellipsisRendered = false;

  return (
    <nav ref={navRef} className="relative flex min-w-0 items-center gap-1 text-xs text-muted-foreground flex-nowrap">
      <Link
        href="/"
        className="hit-target-box inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_50%,transparent)] [--hit-target-radius:var(--radius-md)]"
        title="Home"
      >
        <Home size={14} />
      </Link>
      {parts.map((part, i) => {
        if (hidden.has(i)) {
          if (ellipsisRendered) return null;
          ellipsisRendered = true;
          const hiddenParts = visibility.hidden.map(index => ({
            index,
            label: parts[index] ?? '',
            href: '/view/' + parts.slice(0, index + 1).map(encodeURIComponent).join('/'),
          }));
          return (
            <span key="breadcrumb-ellipsis" className="flex min-w-0 shrink-0 items-center gap-1">
              <ChevronRight size={12} className="pointer-events-none shrink-0 text-muted-foreground/50" />
              <button
                ref={ellipsisRef}
                type="button"
                onClick={() => setMenuOpen(value => !value)}
                className="hit-target-box inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_50%,transparent)] [--hit-target-radius:var(--radius-md)]"
                aria-label="Show hidden folders"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal size={14} />
              </button>
              {menuOpen && (
                <div
                  ref={menuRef}
                  className="absolute left-10 top-full z-50 mt-1 max-h-72 min-w-[220px] max-w-[min(420px,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg"
                >
                  {hiddenParts.map(item => (
                    <Link
                      key={item.index}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className="flex min-h-8 items-center px-3 text-xs text-foreground transition-colors duration-75 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={item.label}
                    >
                      <span className="truncate">{item.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </span>
          );
        }
        if (!visible.has(i)) return null;
        const isLast = i === parts.length - 1;
        const href = '/view/' + parts.slice(0, i + 1).map(encodeURIComponent).join('/');
        return (
          <span key={i} className="flex items-center gap-1 min-w-0 shrink">
            <ChevronRight size={12} className="pointer-events-none text-muted-foreground/50 shrink-0" />
            {isLast ? (
              <span className="min-w-0 inline-flex min-h-8 items-center gap-1.5 px-2 text-foreground font-medium">
                <FileTypeIcon name={part} />
                <span className="block min-w-[5rem] truncate max-w-[180px] sm:max-w-[260px] md:max-w-[360px]" suppressHydrationWarning>{part}</span>
              </span>
            ) : (
              <Link href={href} className="hit-target-box inline-flex min-h-8 max-w-[120px] items-center px-2 transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation sm:max-w-[160px] md:max-w-[200px] [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_50%,transparent)] [--hit-target-radius:var(--radius-md)]" title={part}>
                <span className="truncate" suppressHydrationWarning>{part}</span>
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
