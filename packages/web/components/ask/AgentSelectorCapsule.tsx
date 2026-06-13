'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Bot, ChevronDown, X, Check } from 'lucide-react';
import type { AgentRuntimeIdentity } from '@/lib/types';
import type { DetectedAgent } from '@/hooks/useAcpDetection';
import { useLocale } from '@/lib/stores/locale-store';

interface AgentSelectorCapsuleProps {
  selectedAgent: AgentRuntimeIdentity | null;
  onSelect: (agent: AgentRuntimeIdentity | null) => void;
  installedAgents: DetectedAgent[];
  nativeRuntimes?: AgentRuntimeIdentity[];
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
  nativeRuntimes = [],
  loading = false,
}: AgentSelectorCapsuleProps) {
  const { t } = useLocale();
  const p = t.panels?.agents ?? {
    acpDefaultAgent: 'MindOS',
    acpSelectAgent: 'Select Agent',
    acpChangeAgent: 'Change agent',
  };
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
    onSelect({ id: agent.id, name: agent.name, kind: 'acp' });
    setOpen(false);
  }, [onSelect]);

  const handleSelectRuntime = useCallback((agent: AgentRuntimeIdentity) => {
    onSelect(agent);
    setOpen(false);
  }, [onSelect]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
  }, [onSelect]);

  const isDefault = !selectedAgent;
  const displayName = selectedAgent?.name ?? p.acpDefaultAgent;

  const dropdown = open && pos ? (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label={p.acpSelectAgent}
      className="fixed z-[60] pointer-events-auto min-w-[180px] max-w-[240px] rounded-lg border border-border bg-card shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100"
      style={{
        left: pos.left,
        ...(pos.direction === 'up'
          ? { bottom: window.innerHeight - pos.top }
          : { top: pos.top }),
      }}
    >
      {/* Default MindOS option */}
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
      {(nativeRuntimes.length > 0 || installedAgents.length > 0) && (
        <div className="mx-2 my-1 border-t border-border/60" />
      )}

      {/* Native agent runtimes */}
      {nativeRuntimes.map((agent) => {
        const isSelected = selectedAgent?.kind === agent.kind && selectedAgent?.id === agent.id;
        return (
          <button
            key={`${agent.kind}:${agent.id}`}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => handleSelectRuntime(agent)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-muted"
          >
            <span className="w-2 h-2 rounded-full bg-[var(--amber)] shrink-0" />
            <span className="flex-1 truncate">{agent.name}</span>
            {isSelected && <Check size={11} className="shrink-0 text-[var(--amber)]" />}
          </button>
        );
      })}

      {nativeRuntimes.length > 0 && installedAgents.length > 0 && (
        <div className="mx-2 my-1 border-t border-border/60" />
      )}

      {/* Installed ACP agents */}
      {installedAgents.map((agent) => {
        const isSelected = selectedAgent?.kind === 'acp' && selectedAgent?.id === agent.id;
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

  const triggerClasses = `
    relative z-10 inline-flex min-h-6 items-center gap-1 px-2.5 py-0.5
    text-2xs font-medium transition-colors pointer-events-auto touch-manipulation
    border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
    ${isDefault
      ? 'rounded-full bg-muted/50 border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground'
      : 'rounded-l-full bg-[var(--amber)]/10 border-[var(--amber)]/25 border-r-0 text-foreground hover:bg-[var(--amber)]/15'
    }
  `;

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setOpen(v => !v)}
      className={triggerClasses}
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
      {!selectedAgent && <ChevronDown size={10} className="shrink-0 text-muted-foreground" />}
    </button>
  );

  return (
    <>
      {selectedAgent ? (
        <span className="relative z-10 inline-flex min-h-6 items-stretch rounded-full">
          {trigger}
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex min-h-6 items-center rounded-r-full border border-[var(--amber)]/25 bg-[var(--amber)]/10 px-1.5 text-muted-foreground transition-colors hover:bg-[var(--amber)]/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Remove ${selectedAgent.name}`}
            title={`Remove ${selectedAgent.name}`}
          >
            <X size={9} />
          </button>
        </span>
      ) : trigger}
      {typeof document !== 'undefined' && dropdown && createPortal(dropdown, document.body)}
    </>
  );
}
