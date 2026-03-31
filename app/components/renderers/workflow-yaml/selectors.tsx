'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';

// ─── Dropdown Shell ───────────────────────────────────────────────────────

function Dropdown({ trigger, children, open, onClose }: {
  trigger: React.ReactNode; children: React.ReactNode; open: boolean; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-full min-w-[200px] max-h-[240px] overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-50">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Agent Selector ───────────────────────────────────────────────────────

const KNOWN_AGENTS = ['cursor', 'claude-code', 'mindos', 'gemini'];

export function AgentSelector({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');

  const select = (v: string | undefined) => { onChange(v); setOpen(false); };

  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button type="button" onClick={() => setOpen(v => !v)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors">
          <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
            {value || 'Select agent'}
          </span>
          <ChevronDown size={12} className="text-muted-foreground" />
        </button>
      }
    >
      <button onClick={() => select(undefined)}
        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${!value ? 'text-[var(--amber)] font-medium' : 'text-muted-foreground'}`}>
        (none)
      </button>
      {KNOWN_AGENTS.map(a => (
        <button key={a} onClick={() => select(a)}
          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === a ? 'text-[var(--amber)] font-medium' : 'text-foreground'}`}>
          {a}
        </button>
      ))}
      <div className="border-t border-border px-2.5 py-1.5">
        <input type="text" value={custom} onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { select(custom.trim()); setCustom(''); } }}
          placeholder="Custom agent..."
          className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </Dropdown>
  );
}

// ─── Skill Selector ───────────────────────────────────────────────────────

interface SkillInfo { name: string; description?: string }

export function SkillSelector({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    fetch('/api/skills').then(r => r.json()).then(data => {
      const list = (data.skills ?? []).map((s: { name: string; description?: string }) => ({
        name: s.name, description: s.description,
      }));
      setSkills(list);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [open, loaded]);

  const filtered = query
    ? skills.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
    : skills;

  const select = (v: string | undefined) => { onChange(v); setOpen(false); setQuery(''); };

  return (
    <Dropdown
      open={open}
      onClose={() => { setOpen(false); setQuery(''); }}
      trigger={
        <button type="button" onClick={() => setOpen(v => !v)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors">
          <span className={value ? 'text-foreground truncate' : 'text-muted-foreground'}>
            {value || 'Select skill'}
          </span>
          {value ? (
            <X size={12} className="text-muted-foreground shrink-0 hover:text-foreground" onClick={e => { e.stopPropagation(); select(undefined); }} />
          ) : (
            <ChevronDown size={12} className="text-muted-foreground shrink-0" />
          )}
        </button>
      }
    >
      <div className="sticky top-0 bg-card border-b border-border px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-background">
          <Search size={11} className="text-muted-foreground shrink-0" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} autoFocus
            placeholder="Search skills..."
            className="flex-1 text-xs bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>
      <button onClick={() => select(undefined)}
        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${!value ? 'text-[var(--amber)] font-medium' : 'text-muted-foreground'}`}>
        (none)
      </button>
      {!loaded && <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>}
      {filtered.slice(0, 50).map(s => (
        <button key={s.name} onClick={() => select(s.name)}
          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === s.name ? 'text-[var(--amber)] font-medium' : 'text-foreground'}`}>
          <span className="block truncate">{s.name}</span>
          {s.description && <span className="block text-2xs text-muted-foreground truncate mt-0.5">{s.description}</span>}
        </button>
      ))}
      {loaded && filtered.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">No skills found</div>
      )}
    </Dropdown>
  );
}
