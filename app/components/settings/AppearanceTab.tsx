'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Sun, Moon, Monitor, Type, Columns3, Globe, TextCursorInput } from 'lucide-react';
import { Locale } from '@/lib/i18n';
import { CONTENT_WIDTHS, FONTS, FONT_SIZES, AppearanceTabProps } from './types';

/* ── Segmented Control ── */
function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border bg-muted/30 p-0.5 gap-0.5">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
            value === opt.value
              ? 'bg-[var(--amber-subtle)] text-foreground shadow-sm border border-[var(--amber)]/30'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ── Setting Group ── */
function SettingGroup({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      {children}
    </div>
  );
}

export function AppearanceTab({ font, setFont, fontSize, setFontSize, contentWidth, setContentWidth, dark, setDark, locale, setLocale, t }: AppearanceTabProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [themePref, setThemePref] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('theme') ?? 'system') : 'system'
  );
  const [localePref, setLocalePref] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('locale') ?? 'system') : 'system'
  );
  const a = t.settings.appearance;

  return (
    <div className="space-y-6">
      {/* Font */}
      <SettingGroup icon={<Type size={14} />} label={a.readingFont}>
        <div className="flex flex-wrap gap-1.5">
          {FONTS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFont(f.value)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
                font === f.value
                  ? 'border-[var(--amber)] bg-[var(--amber-subtle)] text-foreground font-medium shadow-sm'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              style={{ fontFamily: f.style.fontFamily }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p
          className="text-sm text-muted-foreground leading-relaxed px-0.5 mt-1"
          style={{ fontFamily: FONTS.find(f => f.value === font)?.style.fontFamily }}
        >
          {a.fontPreview}
        </p>
      </SettingGroup>

      {/* Font Size */}
      <SettingGroup icon={<TextCursorInput size={14} />} label={a.fontSize}>
        <div className="flex flex-wrap gap-1.5">
          {FONT_SIZES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => setFontSize(s.value)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
                fontSize === s.value
                  ? 'border-[var(--amber)] bg-[var(--amber-subtle)] text-foreground font-medium shadow-sm'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {s.label}{s.isDefault ? <span className="ml-1 text-muted-foreground/60 text-xs font-normal">px</span> : <span className="ml-0.5 text-muted-foreground/60 text-xs font-normal">px</span>}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed px-0.5 mt-1" style={{ fontSize }}>
          {a.fontSizePreview}
        </p>
      </SettingGroup>

      {/* Content Width */}
      <SettingGroup icon={<Columns3 size={14} />} label={a.contentWidth}>
        <div className="flex flex-wrap gap-1.5">
          {CONTENT_WIDTHS.map(w => (
            <button
              key={w.value}
              type="button"
              onClick={() => setContentWidth(w.value)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
                contentWidth === w.value
                  ? 'border-[var(--amber)] bg-[var(--amber-subtle)] text-foreground font-medium shadow-sm'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </SettingGroup>

      {/* Theme */}
      <SettingGroup icon={<Sun size={14} />} label={a.colorTheme}>
        <SegmentedControl
          options={[
            { value: 'system', label: a.system, icon: <Monitor size={12} /> },
            { value: 'dark', label: a.dark, icon: <Moon size={12} /> },
            { value: 'light', label: a.light, icon: <Sun size={12} /> },
          ]}
          value={themePref}
          onChange={v => {
            setThemePref(v);
            localStorage.setItem('theme', v);
            const isDark = v === 'system'
              ? window.matchMedia('(prefers-color-scheme: dark)').matches
              : v === 'dark';
            setDark(isDark);
            document.documentElement.classList.toggle('dark', isDark);
          }}
        />
      </SettingGroup>

      {/* Language */}
      <SettingGroup icon={<Globe size={14} />} label={a.language}>
        <SegmentedControl
          options={[
            { value: 'system', label: a.system, icon: <Monitor size={12} /> },
            { value: 'en', label: 'English' },
            { value: 'zh', label: '中文' },
          ]}
          value={localePref}
          onChange={v => {
            setLocalePref(v);
            localStorage.setItem('locale', v);
            const resolved: Locale = v === 'system'
              ? (navigator.language.startsWith('zh') ? 'zh' : 'en')
              : v as Locale;
            setLocale(resolved);
            // Sync cookie for SSR (write resolved value, not 'system')
            document.cookie = `locale=${resolved};path=/;max-age=31536000;SameSite=Lax`;
          }}
        />
      </SettingGroup>

      <p className="text-xs text-muted-foreground/50 px-0.5">{a.browserNote}</p>

      {/* Keyboard Shortcuts */}
      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setShowShortcuts(!showShortcuts)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showShortcuts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t.settings.tabs.shortcuts}
        </button>
        {showShortcuts && (
          <div className="mt-3 space-y-0.5">
            {t.shortcuts.map((s: { readonly description: string; readonly keys: readonly string[] }, i: number) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-1">
                <span className="text-sm text-foreground">{s.description}</span>
                <div className="flex items-center gap-1">
                  {s.keys.map((k: string, j: number) => (
                    <kbd key={j} className="px-1.5 py-0.5 text-2xs font-mono bg-muted border border-border rounded text-muted-foreground">{k}</kbd>
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
