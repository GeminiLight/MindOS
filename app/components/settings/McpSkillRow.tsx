'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2, Pencil, Loader2, AlertCircle } from 'lucide-react';
import { Toggle } from './Primitives';
import dynamic from 'next/dynamic';
import type { SkillInfo } from './types';

const MarkdownView = dynamic(() => import('@/components/MarkdownView'), { ssr: false });

/** Strip YAML frontmatter (first `---` … `---` block) from markdown content. */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\n+/, '');
}

interface SkillRowProps {
  skill: SkillInfo;
  expanded: boolean;
  onExpand: (name: string) => void;
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
  onEditStart: (name: string) => void;
  onEditSave: (name: string) => void;
  onEditCancel: () => void;
  editing: string | null;
  editContent: string;
  setEditContent: (v: string) => void;
  editError: string;
  saving: boolean;
  fullContent: Record<string, string>;
  loadingContent: string | null;
  loadErrors: Record<string, string>;
  m: Record<string, any> | undefined;
}

export default function SkillRow({
  skill, expanded, onExpand, onToggle, onDelete,
  onEditStart, onEditSave, onEditCancel,
  editing, editContent, setEditContent, editError, saving,
  fullContent, loadingContent, loadErrors, m,
}: SkillRowProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => onExpand(skill.name)}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-medium flex-1">{skill.name}</span>
        <span className={`text-2xs px-1.5 py-0.5 rounded ${
          skill.source === 'builtin' ? 'bg-blue-500/15 text-blue-500' : 'bg-purple-500/15 text-purple-500'
        }`}>
          {skill.source === 'builtin' ? (m?.skillBuiltin ?? 'Built-in') : (m?.skillUser ?? 'Custom')}
        </span>
        <Toggle size="sm" checked={skill.enabled} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggle(skill.name, !skill.enabled); }} />
      </div>

      {expanded && (
        <div className="px-3 py-2 border-t border-border text-xs space-y-2 bg-muted/20">
          <p className="text-muted-foreground">{skill.description || 'No description'}</p>
          <p className="text-muted-foreground font-mono text-2xs">{skill.path}</p>

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
                      onClick={() => onEditStart(skill.name)}
                      className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil size={10} />
                      {m?.editSkill ?? 'Edit'}
                    </button>
                  )}
                  {skill.editable && (
                    <button
                      onClick={() => onDelete(skill.name)}
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
                      onClick={() => onEditSave(skill.name)}
                      disabled={saving}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
                    >
                      {saving && <Loader2 size={10} className="animate-spin" />}
                      {m?.saveSkill ?? 'Save'}
                    </button>
                    <button
                      onClick={onEditCancel}
                      className="px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {m?.cancelSkill ?? 'Cancel'}
                    </button>
                  </div>
                  {editError && (
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
}
