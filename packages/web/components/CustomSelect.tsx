'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  suffix?: React.ReactNode;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

export type SelectItem = SelectOption | SelectOptionGroup;

function isGroup(item: SelectItem): item is SelectOptionGroup {
  return 'options' in item;
}

function flatOptions(items: SelectItem[]): SelectOption[] {
  const result: SelectOption[] = [];
  for (const item of items) {
    if (isGroup(item)) result.push(...item.options);
    else result.push(item);
  }
  return result;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectItem[];
  className?: string;
  /** 'sm' for inline/compact, 'md' (default) for form fields */
  size?: 'sm' | 'md';
  placeholder?: string;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  className = '',
  size = 'md',
  placeholder,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; flipUp: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allOptions = useMemo(() => flatOptions(options), [options]);

  const selectedLabel = useMemo(() => {
    return allOptions.find(o => o.value === value) ?? null;
  }, [allOptions, value]);

  const close = useCallback(() => {
    setOpen(false);
    setHighlightIdx(-1);
  }, []);

  const select = useCallback((val: string) => {
    onChange(val);
    close();
  }, [onChange, close]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        listRef.current && !listRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, close]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          close();
          btnRef.current?.focus();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIdx(prev => Math.min(prev + 1, allOptions.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIdx(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightIdx >= 0 && highlightIdx < allOptions.length) {
            select(allOptions[highlightIdx].value);
            btnRef.current?.focus();
          }
          break;
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, close, highlightIdx, allOptions, select]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (!open || !listRef.current || highlightIdx < 0) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [open, highlightIdx]);

  const calcPosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const maxH = size === 'sm' ? 200 : 260;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setPanelPos({
      top: spaceBelow < maxH + 8 && spaceAbove > spaceBelow ? rect.top : rect.bottom,
      left: rect.left,
      width: rect.width,
      flipUp: spaceBelow < maxH + 8 && spaceAbove > spaceBelow,
    });
  }, [size]);

  // Initialize highlight + position when opening; reposition on scroll/resize
  useEffect(() => {
    if (!open) { setPanelPos(null); return; }
    const idx = allOptions.findIndex(o => o.value === value);
    setHighlightIdx(idx >= 0 ? idx : 0);
    calcPosition();
    window.addEventListener('scroll', calcPosition, true);
    window.addEventListener('resize', calcPosition);
    return () => {
      window.removeEventListener('scroll', calcPosition, true);
      window.removeEventListener('resize', calcPosition);
    };
  }, [open, allOptions, value, calcPosition]);

  const isSm = size === 'sm';

  const triggerCls = isSm
    ? `inline-flex items-center gap-1 appearance-none rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors text-2xs px-1.5 py-0.5 pr-5 ${className}`
    : `w-full flex items-center gap-2 appearance-none rounded-lg border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors text-sm px-3 py-2 pr-8 ${className}`;

  const chevronCls = isSm
    ? 'absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none'
    : 'absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none';

  const listBaseCls = isSm
    ? 'fixed z-50 overflow-y-auto rounded-md border border-border bg-card shadow-lg py-0.5'
    : 'fixed z-50 overflow-y-auto rounded-lg border border-border bg-card shadow-lg py-1';

  const itemBaseCls = isSm
    ? 'w-full flex items-center gap-1.5 px-2 py-1 text-2xs text-left transition-colors cursor-pointer'
    : 'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors cursor-pointer';

  // Track flat index across groups for keyboard highlight
  let flatIdx = -1;

  function renderOption(opt: SelectOption) {
    flatIdx++;
    const idx = flatIdx;
    const isSelected = opt.value === value;
    const isHighlighted = idx === highlightIdx;
    return (
      <button
        key={opt.value}
        type="button"
        role="option"
        aria-selected={isSelected}
        data-idx={idx}
        onClick={() => select(opt.value)}
        onMouseEnter={() => setHighlightIdx(idx)}
        className={`${itemBaseCls} ${
          isHighlighted ? 'bg-muted text-foreground' : 'text-foreground'
        }`}
      >
        {opt.icon}
        <span className="flex-1 truncate">{opt.label}</span>
        {opt.suffix}
        {isSelected && <Check size={isSm ? 10 : 12} className="shrink-0 text-[var(--amber)]" />}
      </button>
    );
  }

  const listPortal = open && panelPos && createPortal(
    <div
      ref={listRef}
      className={listBaseCls}
      role="listbox"
      style={{
        left: panelPos.left,
        minWidth: panelPos.width,
        maxHeight: isSm ? 200 : 260,
        ...(panelPos.flipUp
          ? { bottom: window.innerHeight - panelPos.top + 4 }
          : { top: panelPos.top + 4 }),
      }}
    >
      {options.map((item, idx) => {
        if (isGroup(item)) {
          return (
            <div key={item.label}>
              {idx > 0 && <div className="my-0.5 border-t border-border/50" />}
              <div className={`py-1 text-2xs font-medium text-muted-foreground uppercase tracking-wider ${isSm ? 'px-2' : 'px-3'}`}>
                {item.label}
              </div>
              {item.options.map(renderOption)}
            </div>
          );
        }
        return renderOption(item);
      })}
    </div>,
    document.body,
  );

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={triggerCls}
      >
        {selectedLabel?.icon}
        <span className="flex-1 truncate text-left">
          {selectedLabel?.label ?? placeholder ?? '—'}
        </span>
        {selectedLabel?.suffix}
        <ChevronDown
          size={isSm ? 12 : 14}
          className={`${chevronCls} transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {listPortal}
    </div>
  );
}
