'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Bot, ChevronDown, X, Check } from 'lucide-react';
import type { AcpAgentSelection } from '@/hooks/useAskModal';
import type { DetectedAgent } from '@/hooks/useAcpDetection';
import { useLocale } from '@/lib/stores/locale-store';

interface AgentSelectorCapsuleProps {
  selectedAgent: AcpAgentSelection | null;
  onSelect: (agent: AcpAgentSelection | null) => void;
  installedAgents: DetectedAgent[];
  loading?: boolean;
}

interface DropdownPos {
  top: number;
  left: number;
  direction: 'up' | 'down';
}

export default function AgentSelectorCapsule({
  selectedAgent,
  onSelect,
  installedAgents,
  loading = false,
}: AgentSelectorCapsuleProps) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Position the dropdown relative to the trigger, rendered via portal
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedH = 200; // approximate dropdown height
    const direction: 'up' | 'down' = spaceAbove > spaceBelow && spaceAbove > estimatedH ? 'up' : 'down';

    setPos({
      left: rect.left,
      top: direction === 'up' ? rect.top - 6 : rect.bottom + 6,
      direction,
    });
  }, [open]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const reposition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const estimatedH = 200;
      const direction: 'up' | 'down' = spaceAbove > spaceBelow && spaceAbove > estimatedH ? 'up' : 'down';
      setPos({
        left: rect.left,
        top: direction === 'up' ? rect.top - 6 : rect.bottom + 6,
        direction,
      });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const handleSelectDefault = useCallback(() => {
    onSelect(null);
    setOpen(false);
  }, [onSelect]);

  const handleSelectAgent = useCallback((agent: DetectedAgent) => {
    onSelect({ id: agent.id, name: agent.name });
    setOpen(false);
  }, [onSelect]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
  }, [onSelect]);

  const isDefault = !selectedAgent;
  const displayName = selectedAgent?.name ?? p.acpDefaultAgent;

  // Only show if there are installed agents to choose from
  if (!loading && installedAgents.length === 0 && !selectedAgent) return null;

  const dropdown = open && pos ? (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label={p.acpSelectAgent}
      className="fixed z-50 min-w-[180px] max-w-[240px] rounded-lg border border-border bg-card shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100"
      style={{
        left: pos.left,
        ...(pos.direction === 'up'
          ? { bottom: window.innerHeight - pos.top }
          : { top: pos.top }),
      }}
    >
      {/* Default MindOS Agent option */}
      <button
        type="button"
        role="option"
        aria-selected={isDefault}
        onClick={handleSelectDefault}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-muted"
      >
        <Bot size={12} className="shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate font-medium">{p.acpDefaultAgent}</span>
        {isDefault && <Check size={11} className="shrink-0 text-[var(--amber)]" />}
      </button>

      {/* Divider */}
      {installedAgents.length > 0 && (
        <div className="mx-2 my-1 border-t border-border/60" />
      )}

      {/* Installed ACP agents */}
      {installedAgents.map((agent) => {
        const isSelected = selectedAgent?.id === agent.id;
        return (
          <button
            key={agent.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => handleSelectAgent(agent)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-muted"
          >
            <span className="w-2 h-2 rounded-full bg-[var(--success)] shrink-0" />
            <span className="flex-1 truncate">{agent.name}</span>
            {isSelected && <Check size={11} className="shrink-0 text-[var(--amber)]" />}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`
          inline-flex items-center gap-1 rounded-full px-2.5 py-0.5
          text-2xs font-medium transition-colors
          border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          ${isDefault
            ? 'bg-muted/50 border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground'
            : 'bg-[var(--amber)]/10 border-[var(--amber)]/25 text-foreground hover:bg-[var(--amber)]/15'
          }
        `}
        title={p.acpChangeAgent}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {isDefault ? (
          <Bot size={11} className="shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] shrink-0" />
        )}
        <span className="truncate max-w-[120px]">{displayName}</span>
        {selectedAgent ? (
          <span
            role="button"
            tabIndex={0}
            onClick={handleClear}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClear(e as unknown as React.MouseEvent); } }}
            className="p-0.5 -mr-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`Remove ${selectedAgent.name}`}
          >
            <X size={9} />
          </span>
        ) : (
          <ChevronDown size={10} className="shrink-0 text-muted-foreground" />
        )}
      </button>
      {typeof document !== 'undefined' && dropdown && createPortal(dropdown, document.body)}
    </>
  );
}
