'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Locale } from '@/lib/i18n';
import { CONTENT_WIDTHS, FONTS, AppearanceTabProps } from './types';
import { Field, Select } from './Primitives';

export function AppearanceTab({ font, setFont, contentWidth, setContentWidth, dark, setDark, locale, setLocale, t }: AppearanceTabProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);

  return (
    <div className="space-y-5">
      <Field label={t.settings.appearance.readingFont}>
        <Select value={font} onChange={e => setFont(e.target.value)}>
          {FONTS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground mt-1.5 px-0.5" style={{ fontFamily: FONTS.find(f => f.value === font)?.style.fontFamily }}>
          {t.settings.appearance.fontPreview}
        </p>
      </Field>

      <Field label={t.settings.appearance.contentWidth}>
        <div className="grid grid-cols-2 gap-2">
          {CONTENT_WIDTHS.map(w => (
            <button
              key={w.value}
              type="button"
              onClick={() => setContentWidth(w.value)}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                contentWidth === w.value
                  ? 'border-amber-500 bg-amber-500/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-border/80 hover:bg-muted'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t.settings.appearance.colorTheme}>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'dark', label: t.settings.appearance.dark },
            { value: 'light', label: t.settings.appearance.light },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                const isDark = opt.value === 'dark';
                setDark(isDark);
                document.documentElement.classList.toggle('dark', isDark);
                localStorage.setItem('theme', opt.value);
              }}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                (opt.value === 'dark') === dark
                  ? 'border-amber-500 bg-amber-500/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-border/80 hover:bg-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t.settings.appearance.language}>
        <div className="grid grid-cols-2 gap-2">
          {([['en', 'English'], ['zh', '中文']] as [Locale, string][]).map(([code, label]) => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                locale === code
                  ? 'border-amber-500 bg-amber-500/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-border/80 hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <p className="text-xs text-muted-foreground">{t.settings.appearance.browserNote}</p>

      {/* Keyboard Shortcuts */}
      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setShowShortcuts(!showShortcuts)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          {showShortcuts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t.settings.tabs.shortcuts}
        </button>
        {showShortcuts && (
          <div className="mt-3 space-y-1">
            {t.shortcuts.map((s: { readonly description: string; readonly keys: readonly string[] }, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm text-foreground">{s.description}</span>
                <div className="flex items-center gap-1">
                  {s.keys.map((k: string, j: number) => (
                    <kbd key={j} className="px-2 py-0.5 text-xs font-mono bg-muted border border-border rounded text-foreground">{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
