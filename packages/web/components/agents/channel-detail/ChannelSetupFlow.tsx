import { useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlatformDef } from '@/lib/im/platforms';
import { ActionResult } from './shared';
import { ChannelSetupMethods } from './ChannelSetupMethods';

export function ChannelSetupFlow({ platform, im, locale, onSaved }: {
  platform: PlatformDef;
  im: Record<string, any>;
  locale: string;
  onSaved: () => void;
}) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const isComplete = platform.fields.filter(f => !f.optional).every(f => formValues[f.key]?.trim());
  const purpose = locale === 'zh' ? (platform.purposeZh ?? platform.purpose ?? '') : (platform.purpose ?? '');
  const useCases = locale === 'zh' ? (platform.useCasesZh ?? platform.useCases ?? []) : (platform.useCases ?? []);
  const guide = locale === 'zh' ? (platform.guideZh ?? platform.guide ?? '') : (platform.guide ?? platform.guideZh ?? '');

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch('/api/im/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platform.id, credentials: formValues }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult({ ok: true, msg: im.saved });
        setFormValues({});
        onSaved();
      } else {
        setResult({ ok: false, msg: data.error || 'Failed' });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : (im.networkError ?? 'Network error') });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Value proposition */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <p className="text-sm text-foreground leading-relaxed max-w-prose mb-4">{purpose}</p>
        {useCases.length > 0 && (
          <ul className="space-y-2">
            {useCases.map(item => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[var(--amber)] shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ChannelSetupMethods platform={platform} im={im} locale={locale} />

      {/* Setup steps + form */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground tracking-tight mb-4">{im.manualSetupTitle}</h3>

        {guide && (
          <div className="rounded-md bg-muted/30 border border-border/50 px-4 py-3 mb-5">
            <div className="text-sm text-muted-foreground leading-7 space-y-1">
              {guide.split('\n').map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
            {platform.guideUrl && (
              <Link
                href={platform.guideUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 mt-3 text-xs text-[var(--amber)] hover:underline"
              >
                {im.guideLink}
                <ExternalLink size={11} />
              </Link>
            )}
          </div>
        )}

        <div className="space-y-4">
          {platform.fields.map(field => {
            const fieldLabel = locale === 'zh' ? (field.labelZh ?? field.label) : field.label;
            const fieldHint = locale === 'zh' ? (field.hintZh ?? field.hint) : field.hint;

            return (
              <div key={field.key}>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  {fieldLabel}
                </label>
                <div className="relative">
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    placeholder={field.placeholder}
                    value={formValues[field.key] ?? ''}
                    onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    className="h-10 w-full px-3 pr-10 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
                    autoComplete="off"
                    aria-required={!field.optional}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecrets(prev => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={showSecrets ? im.hideSecret : im.showSecret}
                  >
                    {showSecrets ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {fieldHint && <p className="text-xs text-muted-foreground mt-1">{fieldHint}</p>}
              </div>
            );
          })}

          <div className="pt-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || !isComplete}
              variant="amber"
              size="xl"
              className="px-5 disabled:opacity-40"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? im.saving : im.saveConfig}
            </Button>
          </div>

          <ActionResult result={result} />
        </div>
      </section>
    </div>
  );
}
