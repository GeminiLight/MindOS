'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, ChevronDown, ChevronRight,
  Plus, X, Search, Copy, FolderOpen, Trash2,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { apiFetch } from '@/lib/api';
import { useMcpDataOptional } from '@/lib/stores/mcp-store';
import { ConfirmDialog } from '@/components/agents/AgentsPrimitives';
import { copyToClipboard } from '@/lib/clipboard';
import type { SkillInfo, McpSkillsSectionProps } from './types';
import SkillRow from './McpSkillRow';
import SkillCreateForm from './McpSkillCreateForm';
import CustomSelect from '@/components/CustomSelect';
import type { SelectItem } from '@/components/CustomSelect';

/* ── Skills Section ────────────────────────────────────────────── */

export default function SkillsSection({ t }: McpSkillsSectionProps) {
  const m = t.settings?.mcp;
  const mcp = useMcpDataOptional();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  const [search, setSearch] = useState('');
  const [builtinCollapsed, setBuiltinCollapsed] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editError, setEditError] = useState('');
  const [fullContent, setFullContent] = useState<Record<string, string>>({});
  const [loadingContent, setLoadingContent] = useState<string | null>(null);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [switchingLang, setSwitchingLang] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const data = await apiFetch<{ skills: SkillInfo[] }>('/api/skills');
      setSkills(data.skills);
      setLoadErrors({});
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load skills';
      console.error('fetchSkills error:', msg);
      setLoadErrors(prev => ({ ...prev, _root: msg }));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // Filtered + grouped
  const filtered = useMemo(() => {
    if (!search) return skills;
    const q = search.toLowerCase();
    return skills.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [skills, search]);

  const customSkills = useMemo(() => filtered.filter(s => s.source === 'user'), [filtered]);
  const builtinSkills = useMemo(() => filtered.filter(s => s.source === 'builtin'), [filtered]);

  // ── Handlers ──

  const handleToggle = async (name: string, enabled: boolean) => {
    if (mcp) {
      await mcp.toggleSkill(name, enabled);
      setSkills(prev => prev.map(s => s.name === name ? { ...s, enabled } : s));
      return;
    }
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', name, enabled }),
      });
      setSkills(prev => prev.map(s => s.name === name ? { ...s, enabled } : s));
      setLoadErrors(prev => { const next = { ...prev }; delete next[name]; return next; });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle skill';
      console.error('handleToggle error:', msg);
      setLoadErrors(prev => ({ ...prev, [name]: msg }));
    }
  };

  const handleDelete = (name: string) => {
    setDeleteTarget(name);
  };

  const doDelete = async (name: string) => {
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', name }),
      });
      setFullContent(prev => { const n = { ...prev }; delete n[name]; return n; });
      if (editing === name) setEditing(null);
      if (expanded === name) setExpanded(null);
      setLoadErrors(prev => { const next = { ...prev }; delete next[name]; return next; });
      fetchSkills();
      window.dispatchEvent(new Event('mindos:skills-changed'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete skill';
      console.error('handleDelete error:', msg);
      setLoadErrors(prev => ({ ...prev, [name]: msg }));
    }
  };

  const loadFullContent = async (name: string) => {
    if (fullContent[name]) return;
    setLoadingContent(name);
    try {
      const data = await apiFetch<{ content: string }>('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', name }),
      });
      setFullContent(prev => ({ ...prev, [name]: data.content }));
      setLoadErrors(prev => { const n = { ...prev }; delete n[name]; return n; });
    } catch (err: unknown) {
      setLoadErrors(prev => ({ ...prev, [name]: err instanceof Error ? err.message : 'Failed to load skill content' }));
    } finally {
      setLoadingContent(null);
    }
  };

  const handleExpand = (name: string) => {
    const next = expanded === name ? null : name;
    setExpanded(next);
    if (next) loadFullContent(name);
    if (editing && editing !== name) setEditing(null);
  };

  const handleEditStart = (name: string) => {
    setEditing(name);
    setEditContent(fullContent[name] || '');
    setEditError('');
  };

  const handleEditSave = async (name: string) => {
    setSaving(true);
    setEditError('');
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', name, content: editContent }),
      });
      setFullContent(prev => ({ ...prev, [name]: editContent }));
      setEditing(null);
      fetchSkills();
      window.dispatchEvent(new Event('mindos:skills-changed'));
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to save skill');
    } finally {
      setSaving(false);
    }
  };

  const handleEditCancel = () => {
    setEditing(null);
    setEditContent('');
    setEditError('');
  };

  const handleCreate = async (name: string, content: string) => {
    if (!name) return;
    setSaving(true);
    setCreateError('');
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, content }),
      });
      setAdding(false);
      fetchSkills();
      window.dispatchEvent(new Event('mindos:skills-changed'));
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="space-y-3 pt-2">
      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={m?.searchSkills ?? 'Search skills...'}
          className="w-full pl-7 pr-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X size={10} />
          </button>
        )}
      </div>

      {/* Skill language switcher */}
      {(() => {
        const mindosEnabled = skills.find(s => s.name === 'mindos')?.enabled ?? true;
        const currentLang = mindosEnabled ? 'en' : 'zh';
        const handleLangSwitch = async (lang: 'en' | 'zh') => {
          if (lang === currentLang || switchingLang) return;
          setSwitchingLang(true);
          try {
            if (lang === 'en') {
              await handleToggle('mindos', true);
              await handleToggle('mindos-zh', false);
            } else {
              await handleToggle('mindos-zh', true);
              await handleToggle('mindos', false);
            }
          } catch (err) {
            console.error('Lang switch failed:', err);
          } finally {
            setSwitchingLang(false);
          }
        };
        return (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{m?.skillLanguage ?? 'Skill Language'}</span>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => handleLangSwitch('en')}
                disabled={switchingLang}
                className={`px-2.5 py-1 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  currentLang === 'en' ? 'bg-[var(--amber-subtle)] text-[var(--amber-text)] font-medium' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {m?.skillLangEn ?? 'English'}
              </button>
              <button
                onClick={() => handleLangSwitch('zh')}
                disabled={switchingLang}
                className={`px-2.5 py-1 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-l border-border ${
                  currentLang === 'zh' ? 'bg-[var(--amber-subtle)] text-[var(--amber-text)] font-medium' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {m?.skillLangZh ?? '中文'}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Empty search result */}
      {filtered.length === 0 && search && (
        <p className="text-xs text-muted-foreground text-center py-3">
          {m?.noSkillsMatch ? m.noSkillsMatch(search) : `No skills match "${search}"`}
        </p>
      )}

      {/* Custom group */}
      {customSkills.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>{m?.customGroup ?? 'Custom'} ({customSkills.length})</span>
          </div>
          <div className="space-y-1.5">
            {customSkills.map(skill => (
              <SkillRow
                key={skill.name}
                skill={skill}
                expanded={expanded === skill.name}
                onExpand={handleExpand}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onEditStart={handleEditStart}
                onEditSave={handleEditSave}
                onEditCancel={handleEditCancel}
                editing={editing}
                editContent={editContent}
                setEditContent={setEditContent}
                editError={editError}
                saving={saving}
                fullContent={fullContent}
                loadingContent={loadingContent}
                loadErrors={loadErrors}
                m={m}
              />
            ))}
          </div>
        </div>
      )}

      {/* Built-in group */}
      {builtinSkills.length > 0 && (
        <div className="space-y-1.5">
          <div
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            onClick={() => setBuiltinCollapsed(!builtinCollapsed)}
          >
            {builtinCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{m?.builtinGroup ?? 'Built-in'} ({builtinSkills.length})</span>
          </div>
          {!builtinCollapsed && (
            <div className="space-y-1.5">
              {builtinSkills.map(skill => (
                <SkillRow
                  key={skill.name}
                  skill={skill}
                  expanded={expanded === skill.name}
                  onExpand={handleExpand}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEditStart={handleEditStart}
                  onEditSave={handleEditSave}
                  onEditCancel={handleEditCancel}
                  editing={editing}
                  editContent={editContent}
                  setEditContent={setEditContent}
                  editError={editError}
                  saving={saving}
                  fullContent={fullContent}
                  loadingContent={loadingContent}
                  loadErrors={loadErrors}
                  m={m}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add skill */}
      {adding ? (
        <SkillCreateForm
          onSave={handleCreate}
          onCancel={() => { setAdding(false); setCreateError(''); }}
          saving={saving}
          error={createError}
          m={m}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus size={12} />
          {m?.addSkill ?? '+ Add Skill'}
        </button>
      )}

      {/* Skill Search Paths */}
      <SkillSearchPathsSection m={m} />

      {/* CLI install hint with agent selector */}
      <SkillCliHint
        agents={mcp?.agents ?? []}
        skillName={(() => {
          const mindosEnabled = skills.find(s => s.name === 'mindos')?.enabled ?? true;
          return mindosEnabled ? 'mindos' : 'mindos-zh';
        })()}
        m={m}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete skill?"
        message={deleteTarget ? (m?.skillDeleteConfirm?.(deleteTarget) ?? `Delete skill "${deleteTarget}"?`) : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={async () => {
          const name = deleteTarget!;
          setDeleteTarget(null);
          await doDelete(name);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ── Skill Search Paths ── */

function SkillSearchPathsSection({ m }: { m: Record<string, any> | undefined }) {
  const [enableAgentsDir, setEnableAgentsDir] = useState(true);
  const [customPaths, setCustomPaths] = useState<string[]>([]);
  const [newPath, setNewPath] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ skillPaths?: { enableAgentsDir?: boolean; custom?: string[] } }>('/api/settings');
        setEnableAgentsDir(data.skillPaths?.enableAgentsDir !== false);
        setCustomPaths(data.skillPaths?.custom ?? []);
      } catch { /* ignore */ }
      setLoaded(true);
    })();
  }, []);

  const save = async (agentsDir: boolean, paths: string[]) => {
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillPaths: { enableAgentsDir: agentsDir, custom: paths } }),
      });
    } catch (err) {
      console.error('Failed to save skill paths:', err);
    }
  };

  const handleToggleAgentsDir = async () => {
    const next = !enableAgentsDir;
    setEnableAgentsDir(next);
    await save(next, customPaths);
  };

  const handleAddPath = async () => {
    const trimmed = newPath.trim();
    if (!trimmed || customPaths.includes(trimmed)) return;
    const next = [...customPaths, trimmed];
    setCustomPaths(next);
    setNewPath('');
    await save(enableAgentsDir, next);
  };

  const handleRemovePath = async (idx: number) => {
    const next = customPaths.filter((_, i) => i !== idx);
    setCustomPaths(next);
    await save(enableAgentsDir, next);
  };

  if (!loaded) return null;

  return (
    <div className="border-t border-border pt-3 mt-3 space-y-2.5">
      <p className="text-2xs font-medium text-muted-foreground">
        {m?.skillSearchPaths ?? 'Skill Search Paths'}
      </p>

      {/* ~/.agents/skills toggle */}
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={enableAgentsDir}
          onChange={handleToggleAgentsDir}
          className="rounded border-border accent-[var(--amber)]"
        />
        <FolderOpen size={12} className="text-muted-foreground" />
        <span className="text-foreground">
          {m?.skillAgentsDir ?? 'External agent skills (~/.agents/skills)'}
        </span>
      </label>

      {/* Custom paths */}
      <div className="space-y-1.5">
        <p className="text-2xs text-muted-foreground">{m?.skillCustomPaths ?? 'Custom Paths'}</p>
        {customPaths.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <code className="flex-1 text-[10px] font-mono bg-muted/50 border border-border rounded px-2 py-1 text-muted-foreground truncate">
              {p}
            </code>
            <button
              onClick={() => handleRemovePath(i)}
              className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
              title={m?.skillPathRemove ?? 'Remove'}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newPath}
            onChange={e => setNewPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddPath()}
            placeholder={m?.skillPathPlaceholder ?? 'Enter directory path...'}
            className="flex-1 text-xs px-2 py-1.5 rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            onClick={handleAddPath}
            disabled={!newPath.trim()}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Skill CLI Install Hint ── */

function SkillCliHint({ agents, skillName, m }: {
  agents: { key: string; name: string; present?: boolean; installed?: boolean }[];
  skillName: string;
  m: Record<string, any> | undefined;
}) {
  const [selectedAgent, setSelectedAgent] = useState('claude-code');
  const cmd = `npx skills add GeminiLight/MindOS --skill ${skillName} -a ${selectedAgent} -g -y`;
  const skillPath = `~/.agents/skills/${skillName}/SKILL.md`;

  const handleCopy = async () => {
    const ok = await copyToClipboard(cmd);
    if (ok) toast.copy();
  };

  // Group agents: connected first, then detected, then not found
  const connected = agents.filter(a => a.present && a.installed);
  const detected = agents.filter(a => a.present && !a.installed);
  const notFound = agents.filter(a => !a.present);

  return (
    <div className="border-t border-border pt-3 mt-3 space-y-2.5">
      <p className="text-2xs font-medium text-muted-foreground">
        {m?.cliInstallHint ?? 'Install via CLI:'}
      </p>

      {/* Agent selector */}
      <CustomSelect
        value={selectedAgent}
        onChange={setSelectedAgent}
        size="sm"
        options={[
          ...(connected.length > 0 ? [{
            label: m?.connectedGroup ?? 'Connected',
            options: connected.map(a => ({ value: a.key, label: a.name })),
          }] : []),
          ...(detected.length > 0 ? [{
            label: m?.detectedGroup ?? 'Detected',
            options: detected.map(a => ({ value: a.key, label: a.name })),
          }] : []),
          ...(notFound.length > 0 ? [{
            label: m?.notFoundGroup ?? 'Not Installed',
            options: notFound.map(a => ({ value: a.key, label: a.name })),
          }] : []),
        ] as SelectItem[]}
      />

      {/* Command */}
      <div className="flex items-center gap-1.5">
        <code className="flex-1 text-[10px] font-mono bg-muted/50 border border-border rounded-lg px-2.5 py-2 text-muted-foreground select-all overflow-x-auto whitespace-nowrap">
          {cmd}
        </code>
        <button onClick={handleCopy}
          className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0">
          <Copy size={11} />
        </button>
      </div>

      {/* Path hint */}
      <p className="text-2xs text-muted-foreground">
        {m?.skillPathHint ?? 'Skill files installed at:'}{' '}
        <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">{skillPath}</code>
      </p>
    </div>
  );
}
