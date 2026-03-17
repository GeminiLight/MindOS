'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

type UiSection = {
  id: string;
  title: string;
  description?: string;
  fields: string[];
};

type KeySpec = {
  type?: string;
  control?: string;
  label?: string;
  description?: string;
  constraints?: { min?: number; max?: number };
};

type ConfigSchema = {
  uiSchema?: { sections?: UiSection[] };
  keySpecs?: Record<string, KeySpec>;
};

function getByPath(obj: unknown, path: string): JsonValue {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || !(p in (cur as Record<string, unknown>))) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur as JsonValue;
}

function setByPath(obj: Record<string, unknown>, path: string, value: JsonValue): Record<string, unknown> {
  const parts = path.split('.');
  const next = structuredClone(obj) as Record<string, unknown>;
  let cur: Record<string, unknown> = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const v = cur[k];
    if (!v || typeof v !== 'object' || Array.isArray(v)) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return next;
}

export function ConfigRenderer({ content, saveAction }: RendererContext) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [content]);

  const [data, setData] = useState<Record<string, unknown> | null>(parsed);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [tagInput, setTagInput] = useState<Record<string, string>>({});

  useEffect(() => {
    setData(parsed);
    setError('');
  }, [parsed]);

  const schema = (data ?? {}) as ConfigSchema;
  const sections = schema.uiSchema?.sections ?? [];
  const keySpecs = schema.keySpecs ?? {};

  const persist = useCallback(async (next: Record<string, unknown>) => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await saveAction(`${JSON.stringify(next, null, 2)}\n`);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [saveAction]);

  const updateValue = useCallback(async (path: string, value: JsonValue) => {
    if (!data) return;
    const next = setByPath(data, path, value);
    setData(next);
    await persist(next);
  }, [data, persist]);

  if (!parsed || !data) {
    return (
      <div className="rounded-xl border border-border p-4 text-sm text-error">
        CONFIG.json parse failed. Please check JSON format.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5">
        <div className="text-xs text-muted-foreground">CONFIG Control Panel</div>
        <div className="text-xs flex items-center gap-2">
          {saving && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 size={12} className="animate-spin" />Saving</span>}
          {!saving && saved && <span className="inline-flex items-center gap-1" style={{ color: 'var(--success)' }}><Check size={12} />Saved</span>}
        </div>
      </div>

      {error && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}

      {sections.map((section) => (
        <div key={section.id} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
            {section.description && <p className="text-xs text-muted-foreground mt-1">{section.description}</p>}
          </div>

          <div className="space-y-3">
            {section.fields.map((fieldPath) => {
              const spec = keySpecs[fieldPath] ?? {};
              const value = getByPath(data, fieldPath);
              const label = spec.label || fieldPath;

              return (
                <div key={fieldPath} className="rounded-lg border border-border/80 bg-background px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div>
                      <div className="text-sm text-foreground">{label}</div>
                      {spec.description && <div className="text-xs text-muted-foreground mt-0.5">{spec.description}</div>}
                    </div>

                    {spec.control === 'switch' && typeof value === 'boolean' && (
                      <button
                        type="button"
                        onClick={() => updateValue(fieldPath, !value)}
                        className="px-2.5 py-1 rounded-md text-xs font-medium"
                        style={{
                          background: value ? 'var(--amber)' : 'var(--muted)',
                          color: value ? '#131210' : 'var(--muted-foreground)',
                        }}
                      >
                        {value ? 'ON' : 'OFF'}
                      </button>
                    )}
                  </div>

                  {spec.control === 'text' && typeof value === 'string' && (
                    <input
                      defaultValue={value}
                      onBlur={(e) => updateValue(fieldPath, e.target.value)}
                      className="w-full px-2 py-1.5 text-sm bg-card border border-border rounded text-foreground"
                    />
                  )}

                  {spec.control === 'number' && typeof value === 'number' && (
                    <input
                      type="number"
                      defaultValue={value}
                      min={spec.constraints?.min}
                      max={spec.constraints?.max}
                      onBlur={(e) => {
                        const raw = Number(e.target.value);
                        const min = spec.constraints?.min;
                        const max = spec.constraints?.max;
                        let next = Number.isFinite(raw) ? raw : value;
                        if (typeof min === 'number' && next < min) next = min;
                        if (typeof max === 'number' && next > max) next = max;
                        updateValue(fieldPath, next);
                      }}
                      className="w-full px-2 py-1.5 text-sm bg-card border border-border rounded text-foreground"
                    />
                  )}

                  {spec.control === 'tag-list' && Array.isArray(value) && (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {value.map((tag, idx) => (
                          <span key={`${String(tag)}-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border text-xs bg-muted text-foreground">
                            {String(tag)}
                            <button
                              type="button"
                              onClick={() => updateValue(fieldPath, value.filter((_, i) => i !== idx))}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          value={tagInput[fieldPath] ?? ''}
                          onChange={(e) => setTagInput((prev) => ({ ...prev, [fieldPath]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            e.preventDefault();
                            const nextTag = (tagInput[fieldPath] ?? '').trim();
                            if (!nextTag) return;
                            updateValue(fieldPath, [...value, nextTag]);
                            setTagInput((prev) => ({ ...prev, [fieldPath]: '' }));
                          }}
                          className="flex-1 px-2 py-1.5 text-sm bg-card border border-border rounded text-foreground"
                          placeholder="Add item"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const nextTag = (tagInput[fieldPath] ?? '').trim();
                            if (!nextTag) return;
                            updateValue(fieldPath, [...value, nextTag]);
                            setTagInput((prev) => ({ ...prev, [fieldPath]: '' }));
                          }}
                          className="px-2.5 py-1.5 rounded-md text-xs bg-muted text-foreground inline-flex items-center gap-1"
                        >
                          <Plus size={12} /> Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
