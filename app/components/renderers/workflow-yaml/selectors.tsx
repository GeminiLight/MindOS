'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, X, Search, FileText, FolderOpen } from 'lucide-react';

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
        <div className="absolute top-full left-0 mt-1 w-full min-w-[220px] max-h-[260px] overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-50">
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
          className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
    </Dropdown>
  );
}

// ─── Model Selector ───────────────────────────────────────────────────────

const KNOWN_MODELS = [
  { group: 'Anthropic', models: ['claude-sonnet-4-6', 'claude-opus-4', 'claude-3.5-sonnet', 'claude-3.5-haiku'] },
  { group: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'] },
  { group: 'Google', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
];

export function ModelSelector({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
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
          <span className={value ? 'text-foreground truncate' : 'text-muted-foreground'}>
            {value || 'Default model'}
          </span>
          {value ? (
            <X size={12} className="text-muted-foreground shrink-0 hover:text-foreground cursor-pointer" onClick={e => { e.stopPropagation(); select(undefined); }} />
          ) : (
            <ChevronDown size={12} className="text-muted-foreground shrink-0" />
          )}
        </button>
      }
    >
      <button onClick={() => select(undefined)}
        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${!value ? 'text-[var(--amber)] font-medium' : 'text-muted-foreground'}`}>
        (default)
      </button>
      {KNOWN_MODELS.map(g => (
        <div key={g.group}>
          <div className="px-3 py-1 text-2xs font-semibold text-muted-foreground/60 uppercase tracking-wide bg-muted/30">{g.group}</div>
          {g.models.map(m => (
            <button key={m} onClick={() => select(m)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${value === m ? 'text-[var(--amber)] font-medium' : 'text-foreground'}`}>
              {m}
            </button>
          ))}
        </div>
      ))}
      <div className="border-t border-border px-2.5 py-1.5">
        <input type="text" value={custom} onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) { select(custom.trim()); setCustom(''); } }}
          placeholder="Custom model ID..."
          className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
    </Dropdown>
  );
}

// ─── Skills Multi-Select ─────────────────────────────────────────────────

interface SkillInfo { name: string; description?: string }

/** Cache skill list globally so all SkillsSelector instances share it */
let _skillsCache: SkillInfo[] | null = null;
let _skillsFetching = false;
const _skillsListeners: Array<(skills: SkillInfo[]) => void> = [];

function fetchSkillsOnce(cb: (skills: SkillInfo[]) => void) {
  if (_skillsCache) { cb(_skillsCache); return; }
  _skillsListeners.push(cb);
  if (_skillsFetching) return;
  _skillsFetching = true;
  fetch('/api/skills').then(r => r.json()).then(data => {
    _skillsCache = (data.skills ?? []).map((s: { name: string; description?: string }) => ({
      name: s.name, description: s.description,
    }));
    _skillsListeners.forEach(fn => fn(_skillsCache!));
    _skillsListeners.length = 0;
  }).catch(() => {
    _skillsCache = [];
    _skillsListeners.forEach(fn => fn([]));
    _skillsListeners.length = 0;
  });
}

export function SkillsSelector({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>(_skillsCache ?? []);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchSkillsOnce(setSkills);
  }, []);

  const filtered = query
    ? skills.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
    : skills;

  const toggle = (name: string) => {
    if (value.includes(name)) {
      onChange(value.filter(v => v !== name));
    } else {
      onChange([...value, name]);
    }
  };

  const remove = (name: string) => onChange(value.filter(v => v !== name));

  return (
    <div>
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {value.map(s => (
            <span key={s} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-2xs bg-[var(--amber)]/10 text-[var(--amber)] border border-[var(--amber)]/20">
              {s}
              <button onClick={() => remove(s)} className="p-0.5 rounded hover:bg-[var(--amber)]/20 transition-colors">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown trigger */}
      <Dropdown
        open={open}
        onClose={() => { setOpen(false); setQuery(''); }}
        trigger={
          <button type="button" onClick={() => setOpen(v => !v)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors">
            <span className="text-muted-foreground">
              {value.length === 0 ? 'Add skills...' : `${value.length} selected`}
            </span>
            <ChevronDown size={12} className="text-muted-foreground" />
          </button>
        }
      >
        {/* Search */}
        <div className="sticky top-0 bg-card border-b border-border px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-background">
            <Search size={11} className="text-muted-foreground shrink-0" />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} autoFocus
              placeholder="Search skills..."
              className="flex-1 text-xs bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </div>

        {/* Skill list with checkboxes */}
        {filtered.slice(0, 60).map(s => {
          const checked = value.includes(s.name);
          return (
            <button key={s.name} onClick={() => toggle(s.name)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2 ${checked ? 'bg-[var(--amber)]/5' : ''}`}>
              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                checked ? 'bg-[var(--amber)] border-[var(--amber)] text-white' : 'border-border'
              }`}>
                {checked && <span className="text-[9px]">✓</span>}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate">{s.name}</span>
                {s.description && <span className="block text-2xs text-muted-foreground truncate mt-0.5">{s.description}</span>}
              </div>
            </button>
          );
        })}
        {skills.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>}
        {skills.length > 0 && filtered.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">No skills found</div>
        )}
      </Dropdown>
    </div>
  );
}

// ─── Context Selector (file drop zone) ───────────────────────────────────

export function ContextSelector({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [manualInput, setManualInput] = useState('');

  const addPath = useCallback((path: string) => {
    const trimmed = path.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
  }, [value, onChange]);

  const remove = (path: string) => onChange(value.filter(v => v !== path));

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    // FileTree drag format: text/mindos-path
    const mindosPath = e.dataTransfer.getData('text/mindos-path');
    if (mindosPath) {
      addPath(mindosPath);
      return;
    }
    // Fallback: plain text
    const text = e.dataTransfer.getData('text/plain');
    if (text) addPath(text);
  }, [addPath]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  return (
    <div>
      {/* Selected files */}
      {value.length > 0 && (
        <div className="flex flex-col gap-1 mb-1.5">
          {value.map(p => (
            <div key={p} className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-2xs bg-muted/60 border border-border group">
              <FileText size={11} className="text-muted-foreground shrink-0" />
              <span className="text-foreground truncate flex-1" title={p}>{p}</span>
              <button onClick={() => remove(p)} className="p-0.5 rounded hover:bg-[var(--error)]/10 text-muted-foreground hover:text-[var(--error)] opacity-0 group-hover:opacity-100 transition-all">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed transition-colors ${
          dragOver
            ? 'border-[var(--amber)] bg-[var(--amber)]/5'
            : 'border-border hover:border-muted-foreground/30'
        }`}
      >
        <FolderOpen size={14} className={`shrink-0 ${dragOver ? 'text-[var(--amber)]' : 'text-muted-foreground/40'}`} />
        <span className="text-2xs text-muted-foreground">
          Drag files here from the sidebar
        </span>
      </div>

      {/* Manual input */}
      <div className="mt-1.5">
        <input type="text" value={manualInput} onChange={e => setManualInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && manualInput.trim()) { addPath(manualInput.trim()); setManualInput(''); } }}
          placeholder="Or type a file path..."
          className="w-full px-2.5 py-1 text-2xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
    </div>
  );
}
