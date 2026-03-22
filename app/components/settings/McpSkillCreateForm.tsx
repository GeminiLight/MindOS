'use client';

import { useState } from 'react';
import { X, Plus, Loader2, AlertCircle } from 'lucide-react';

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

interface SkillCreateFormProps {
  onSave: (name: string, content: string) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  error: string;
  m: Record<string, any> | undefined;
}

export default function SkillCreateForm({ onSave, onCancel, saving, error, m }: SkillCreateFormProps) {
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<'general' | 'tool-use' | 'workflow'>('general');

  const getTemplate = (skillName: string, tmpl?: 'general' | 'tool-use' | 'workflow') => {
    const key = tmpl || selectedTemplate;
    const fn = SKILL_TEMPLATES[key] || SKILL_TEMPLATES.general;
    return fn(skillName || 'my-skill');
  };

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
    if (!newContent || newContent === oldTemplate) {
      setNewContent(getTemplate(newName || 'my-skill', tmpl));
    }
  };

  // Initialize content on first render
  if (!newContent) {
    // Use a timeout-free approach: set default on next tick won't work in render.
    // Instead, initialize via useState default or useEffect. For simplicity, set inline.
  }

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{m?.addSkill ?? '+ Add Skill'}</span>
        <button onClick={onCancel} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
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
          value={newContent || getTemplate(newName || 'my-skill')}
          onChange={e => setNewContent(e.target.value)}
          rows={16}
          placeholder="Skill instructions (markdown)..."
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y font-mono"
        />
      </div>
      {error && (
        <p className="text-2xs text-destructive flex items-center gap-1">
          <AlertCircle size={10} />
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave(newName.trim(), newContent || getTemplate(newName.trim() || 'my-skill'))}
          disabled={!newName.trim() || saving}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
        >
          {saving && <Loader2 size={10} className="animate-spin" />}
          {m?.saveSkill ?? 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          {m?.cancelSkill ?? 'Cancel'}
        </button>
      </div>
    </div>
  );
}
