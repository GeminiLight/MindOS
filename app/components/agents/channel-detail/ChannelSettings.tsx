import { useState } from 'react';
import { Eye, EyeOff, Loader2, Trash2, AlertTriangle, ChevronDown } from 'lucide-react';
import type { PlatformDef } from '@/lib/im/platforms';
import { ActionResult } from './shared';

export function ChannelSettings({ platform, im, onSaved, onDisconnected }: {
  platform: PlatformDef;
  im: Record<string, any>;
  onSaved: () => void;
  onDisconnected: () => void;
}) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isFormComplete = platform.fields.every(f => formValues[f.key]?.trim());

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/im/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platform.id, credentials: formValues }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveResult({ ok: true, msg: im.saved });
        setFormValues({});
        onSaved();
      } else {
        setSaveResult({ ok: false, msg: data.error || 'Failed' });
      }
    } catch (err) {
      setSaveResult({ ok: false, msg: err instanceof Error ? err.message : (im.networkError ?? 'Network error') });
    }
    setSaving(false);
  };

  const handleDisconnect = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    setConfirmDelete(false);
    try {
      const res = await fetch(`/api/im/config?platform=${platform.id}`, { method: 'DELETE' });
      if (res.ok) onDisconnected();
    } catch { /* fetchDetail handles next render */ }
    setDeleting(false);
  };

  return (
    <details className="rounded-lg border border-border bg-card shadow-sm overflow-hidden group">
      <summary className="flex items-center gap-2.5 px-5 py-3.5 cursor-pointer select-none text-sm font-medium text-muted-foreground hover:text-foreground transition-colors list-none [&::-webkit-details-marker]:hidden">
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
        <span>{im.settingsTitle}</span>
        <span className="ml-auto text-xs text-muted-foreground/60 group-open:hidden">{im.settingsHint}</span>
      </summary>

      <div className="border-t border-border px-5 py-4 space-y-5">
        {/* Credential update */}
        <div>
          <h4 className="text-sm font-medium text-foreground mb-1">{im.editCredentials}</h4>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">{im.savedValuesHint}</p>

          <div className="space-y-3">
            {platform.fields.map(field => (
              <div key={field.key}>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  {field.label}
                </label>
                <div className="relative">
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    placeholder={field.placeholder}
                    value={formValues[field.key] ?? ''}
                    onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    className="h-10 w-full px-3 pr-10 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecrets(prev => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                    aria-label={showSecrets ? im.hideSecret : im.showSecret}
                  >
                    {showSecrets ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isFormComplete}
                className="h-10 px-5 text-sm font-medium rounded-md inline-flex items-center gap-2 bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm hover:opacity-90 hover:shadow disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? im.saving : im.saveConfig}
              </button>
            </div>
            <ActionResult result={saveResult} />
          </div>
        </div>

        {/* Danger zone */}
        <div className="border-t border-border pt-4">
          <h4 className="text-sm font-medium text-foreground mb-1">{im.disconnect}</h4>
          <p className="text-xs text-muted-foreground mb-3">{im.disconnectHint}</p>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={deleting}
            className={`h-10 px-4 text-sm rounded-md inline-flex items-center gap-2 border transition-colors ${
              confirmDelete
                ? 'text-error border-error/40 bg-error/5 hover:bg-error/10'
                : 'text-muted-foreground border-border hover:text-error hover:border-error/30'
            }`}
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : confirmDelete ? <><AlertTriangle size={14} /> {im.confirmDisconnect}</> : <Trash2 size={14} />}
            {!confirmDelete && !deleting && <span>{im.disconnect}</span>}
          </button>
        </div>
      </div>
    </details>
  );
}
