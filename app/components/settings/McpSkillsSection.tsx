'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertCircle, Loader2, ChevronDown, ChevronRight,
  Trash2, Plus, X, Search, Pencil,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Toggle } from './Primitives';
import dynamic from 'next/dynamic';
import type { SkillInfo, McpSkillsSectionProps } from './types';

const MarkdownView = dynamic(() => import('@/components/MarkdownView'), { ssr: false });

/* ── Helpers ───────────────────────────────────────────────────── */

/** Strip YAML frontmatter (first `---` … `---` block) from markdown content. */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\n+/, '');
}

const skillFrontmatter = (n: string) => `---
name: ${n}
description: >
  Describe WHEN the agent should use this
  skill. Be specific about trigger conditions.
---`;

const SKILL_TEMPLATES: Record<string, (name: string) => string> = {
  general: (n) => `${skillFrontmatter(n)}

# Instructions

## Context
<!-- Background knowledge for the agent -->

## Steps
1.
2.

## Rules
<!-- Constraints, edge cases, formats -->
- `,

  'tool-use': (n) => `${skillFrontmatter(n)}

# Instructions

## Available Tools
<!-- List tools the agent can use -->
-

## When to Use
<!-- Conditions that trigger this skill -->

## Output Format
<!-- Expected response structure -->
`,

  workflow: (n) => `${skillFrontmatter(n)}

# Instructions

## Trigger
<!-- What triggers this workflow -->

## Steps
1.
2.

## Validation
<!-- How to verify success -->

## Rollback
<!-- What to do on failure -->
`,
};

/* ── Skills Section ────────────────────────────────────────────── */

export default function SkillsSection({ t }: McpSkillsSectionProps) {
  const m = t.settings?.mcp;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
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
  const [selectedTemplate, setSelectedTemplate] = useState<'general' | 'tool-use' | 'workflow'>('general');
  // 🟡 MAJOR #3: Prevent race condition in lang switch
  const [switchingLang, setSwitchingLang] = useState(false);

  const fetchSkills = useCallback(async () => {
    try {
      const data = await apiFetch<{ skills: SkillInfo[] }>('/api/skills');
      setSkills(data.skills);
      setLoadErrors({}); // Clear errors on success
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load skills';
      console.error('fetchSkills error:', msg);
      setLoadErrors(prev => ({ ...prev, _root: msg }));
      // Keep existing skills data rather than clearing
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

  const handleToggle = async (name: string, enabled: boolean) => {
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

  const handleDelete = async (name: string) => {
    const confirmMsg = m?.skillDeleteConfirm ? m.skillDeleteConfirm(name) : `Delete skill "${name}"?`;
    if (!confirm(confirmMsg)) return;
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
    if (next) {
      loadFullContent(name);
    }
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
      fetchSkills(); // refresh description from updated frontmatter
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

  const getTemplate = (skillName: string, tmpl?: 'general' | 'tool-use' | 'workflow') => {
    const key = tmpl || selectedTemplate;
    const fn = SKILL_TEMPLATES[key] || SKILL_TEMPLATES.general;
    return fn(skillName || 'my-skill');
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setCreateError('');
    try {
      // Content is the full SKILL.md (with frontmatter)
      const content = newContent || getTemplate(newName.trim());
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: newName.trim(), content }),
      });
      setAdding(false);
      setNewName('');
      setNewContent('');
      fetchSkills();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  };

  // Sync template name when newName changes (only if content matches a template)
  const handleNameChange = (val: string) => {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const oldTemplate = getTemplate(newName || 'my-skill');
    if (!newContent || newContent === oldTemplate) {
      setNewContent(getTemplate(cleaned || 'my-skill'));
    }
    setNewName(cleaned);
  };

  const handleTemplateChange = (tmpl: 'general' | 'tool-use' | 'workflow') => {
    const oldTemplate = getTemplate(newName || 'my-skill', selectedTemplate);
    setSelectedTemplate(tmpl);
    // Only replace content if it matches the old template (user hasn't customized)
    if (!newContent || newContent === oldTemplate) {
      setNewContent(getTemplate(newName || 'my-skill', tmpl));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderSkillRow = (skill: SkillInfo) => (
    <div key={skill.name} className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => handleExpand(skill.name)}
      >
        {expanded === skill.name ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-medium flex-1">{skill.name}</span>
        <span className={`text-2xs px-1.5 py-0.5 rounded ${
          skill.source === 'builtin' ? 'bg-blue-500/15 text-blue-500' : 'bg-purple-500/15 text-purple-500'
        }`}>
          {skill.source === 'builtin' ? (m?.skillBuiltin ?? 'Built-in') : (m?.skillUser ?? 'Custom')}
        </span>
        <Toggle size="sm" checked={skill.enabled} onClick={e => { e.stopPropagation(); handleToggle(skill.name, !skill.enabled); }} />
      </div>

      {expanded === skill.name && (
        <div className="px-3 py-2 border-t border-border text-xs space-y-2 bg-muted/20">
          <p className="text-muted-foreground">{skill.description || 'No description'}</p>
          <p className="text-muted-foreground font-mono text-2xs">{skill.path}</p>

          {/* Full content display / edit */}
          {loadingContent === skill.name ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 size={10} className="animate-spin" />
              <span className="text-2xs">Loading...</span>
            </div>
          ) : fullContent[skill.name] ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-muted-foreground font-medium">{m?.skillContent ?? 'Content'}</span>
                <div className="flex items-center gap-2">
                  {skill.editable && editing !== skill.name && (
                    <button
                      onClick={() => handleEditStart(skill.name)}
                      className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil size={10} />
                      {m?.editSkill ?? 'Edit'}
                    </button>
                  )}
                  {skill.editable && (
                    <button
                      onClick={() => handleDelete(skill.name)}
                      className="flex items-center gap-1 text-2xs text-destructive hover:underline"
                    >
                      <Trash2 size={10} />
                      {m?.deleteSkill ?? 'Delete'}
                    </button>
                  )}
                </div>
              </div>

              {editing === skill.name ? (
                <div className="space-y-1.5">
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={Math.min(20, (editContent.match(/\n/g) || []).length + 3)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y font-mono"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditSave(skill.name)}
                      disabled={saving}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
                    >
                      {saving && <Loader2 size={10} className="animate-spin" />}
                      {m?.saveSkill ?? 'Save'}
                    </button>
                    <button
                      onClick={handleEditCancel}
                      className="px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {m?.cancelSkill ?? 'Cancel'}
                    </button>
                  </div>
                  {editError && editing === skill.name && (
                    <p className="text-2xs text-destructive flex items-center gap-1">
                      <AlertCircle size={10} />
                      {editError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="w-full rounded-md border border-border bg-background/50 max-h-[300px] overflow-y-auto px-2.5 py-1.5 text-xs [&_.prose]:max-w-none [&_.prose]:text-xs [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_pre]:text-2xs [&_code]:text-2xs">
                  <MarkdownView content={stripFrontmatter(fullContent[skill.name])} />
                </div>
              )}
            </div>
          ) : loadErrors[skill.name] ? (
            <p className="text-2xs text-destructive flex items-center gap-1">
              <AlertCircle size={10} />
              {loadErrors[skill.name]}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );

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
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
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
              // Sequential to ensure both complete or both revert on failure
              await handleToggle('mindos', true);
              await handleToggle('mindos-zh', false);
            } else {
              await handleToggle('mindos-zh', true);
              await handleToggle('mindos', false);
            }
          } catch (err) {
            console.error('Lang switch failed:', err);
            // Errors are already set by handleToggle; no further action needed
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
                  currentLang === 'en'
                    ? 'bg-amber-500/15 text-amber-600 font-medium'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {m?.skillLangEn ?? 'English'}
              </button>
              <button
                onClick={() => handleLangSwitch('zh')}
                disabled={switchingLang}
                className={`px-2.5 py-1 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-l border-border ${
                  currentLang === 'zh'
                    ? 'bg-amber-500/15 text-amber-600 font-medium'
                    : 'text-muted-foreground hover:bg-muted'
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

      {/* Custom group — always open */}
      {customSkills.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>{m?.customGroup ?? 'Custom'} ({customSkills.length})</span>
          </div>
          <div className="space-y-1.5">
            {customSkills.map(renderSkillRow)}
          </div>
        </div>
      )}

      {/* Built-in group — collapsible, default collapsed */}
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
              {builtinSkills.map(renderSkillRow)}
            </div>
          )}
        </div>
      )}

      {/* Add skill form — template-based */}
      {adding ? (
        <div className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{m?.addSkill ?? '+ Add Skill'}</span>
            <button onClick={() => { setAdding(false); setNewName(''); setNewContent(''); setCreateError(''); }} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
              <X size={12} />
            </button>
          </div>
          <div className="space-y-1">
            <label className="text-2xs text-muted-foreground">{m?.skillName ?? 'Name'}</label>
            <input
              type="text"
              value={newName}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="my-skill"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background font-mono text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-2xs text-muted-foreground">{m?.skillTemplate ?? 'Template'}</label>
            <div className="flex rounded-md border border-border overflow-hidden w-fit">
              {(['general', 'tool-use', 'workflow'] as const).map((tmpl, i) => (
                <button
                  key={tmpl}
                  onClick={() => handleTemplateChange(tmpl)}
                  className={`px-2.5 py-1 text-xs transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                    selectedTemplate === tmpl
                      ? 'bg-amber-500/15 text-amber-600 font-medium'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {tmpl === 'general' ? (m?.skillTemplateGeneral ?? 'General')
                    : tmpl === 'tool-use' ? (m?.skillTemplateToolUse ?? 'Tool-use')
                    : (m?.skillTemplateWorkflow ?? 'Workflow')}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-2xs text-muted-foreground">{m?.skillContent ?? 'Content'}</label>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={16}
              placeholder="Skill instructions (markdown)..."
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y font-mono"
            />
          </div>
          {createError && (
            <p className="text-2xs text-destructive flex items-center gap-1">
              <AlertCircle size={10} />
              {createError}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || saving}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
            >
              {saving && <Loader2 size={10} className="animate-spin" />}
              {m?.saveSkill ?? 'Save'}
            </button>
            <button
              onClick={() => { setAdding(false); setNewName(''); setNewContent(''); setCreateError(''); }}
              className="px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {m?.cancelSkill ?? 'Cancel'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setAdding(true); setSelectedTemplate('general'); setNewContent(getTemplate('my-skill', 'general')); }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus size={12} />
          {m?.addSkill ?? '+ Add Skill'}
        </button>
      )}
    </div>
  );
}
