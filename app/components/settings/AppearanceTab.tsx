'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Sun, Moon, Monitor, Type, ALargeSmall, Columns3, Globe, BookOpen, Palette, FlaskConical } from 'lucide-react';
import { Locale } from '@/lib/i18n';
import { CONTENT_WIDTHS, FONTS, FONT_SIZES, AppearanceTabProps } from './types';
import { SettingCard } from './Primitives';

/* ── Setting Group ── */
function SettingGroup({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      {children}
    </div>
  );
}

/* ── Labs Toggle ── */
function LabsToggle({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground block">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
          checked ? 'bg-[var(--amber)]' : 'bg-muted-foreground/20'
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`} />
      </button>
    </label>
  );
}

/* ── Pill Selector — compact horizontal pills ── */
function PillSelector<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-xl transition-all ${
            value === opt.value
              ? 'bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function AppearanceTab({ font, setFont, fontSize, setFontSize, contentWidth, setContentWidth, dark, setDark, locale, setLocale, t }: AppearanceTabProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [labsEcho, setLabsEcho] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('mindos:labs-echo') === '1' : false
  );
  const [labsWorkflows, setLabsWorkflows] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('mindos:labs-workflows') === '1' : false
  );
  const [themePref, setThemePref] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('theme') ?? 'system') : 'system'
  );
  const [localePref, setLocalePref] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('locale') ?? 'system') : 'system'
  );
  const a = t.settings.appearance;

  return (
    <div className="space-y-4">

      {/* ── Card 1: Preferences — theme, language ── */}
      <SettingCard icon={<Palette size={15} />} title={a.preferencesTitle ?? 'Preferences'}>

      {/* ── Theme — amber pills ── */}
      <SettingGroup icon={<Sun size={14} />} label={a.colorTheme}>
        <PillSelector
          options={[
            { value: 'system', label: a.system, icon: <Monitor size={14} /> },
            { value: 'dark', label: a.dark, icon: <Moon size={14} /> },
            { value: 'light', label: a.light, icon: <Sun size={14} /> },
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

      {/* ── Language — amber pills ── */}
      <SettingGroup icon={<Globe size={14} />} label={a.language}>
        <PillSelector
          options={[
            { value: 'system', label: a.system, icon: <Monitor size={14} /> },
            { value: 'en', label: 'EN' },
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
            document.cookie = `locale=${resolved};path=/;max-age=31536000;SameSite=Lax`;
          }}
        />
      </SettingGroup>

      </SettingCard>

      {/* ── Card 2: Reading — font, size, width ── */}
      <SettingCard icon={<BookOpen size={15} />} title={a.readingTitle ?? 'Reading'} description={a.readingDesc ?? 'Customize how your notes look'}>
      <SettingGroup icon={<Type size={14} />} label={a.readingFont}>
        <div className="space-y-0.5">
          {FONTS.map(f => {
            const selected = font === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFont(f.value)}
                className={`flex items-center gap-4 w-full px-3 py-2.5 rounded-lg transition-all text-left relative ${
                  selected
                    ? 'bg-[var(--amber-subtle)]'
                    : 'hover:bg-muted/50'
                }`}
              >
                {/* Active indicator — left bar */}
                {selected && (
                  <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--amber)]" />
                )}
                {/* Large Aa preview */}
                <span
                  className={`text-xl font-medium w-10 text-center shrink-0 ${selected ? 'text-foreground' : 'text-muted-foreground/60'}`}
                  style={{ fontFamily: f.style.fontFamily }}
                >
                  Aa
                </span>
                {/* Font name + sample */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-sm font-medium ${selected ? 'text-foreground' : 'text-muted-foreground'}`}
                      style={{ fontFamily: f.style.fontFamily }}
                    >
                      {f.label}
                    </span>
                    <span className="text-xs text-muted-foreground/50">{f.category}</span>
                  </div>
                  <p
                    className={`text-sm truncate mt-0.5 ${selected ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}
                    style={{ fontFamily: f.style.fontFamily }}
                  >
                    {a.fontPreview}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </SettingGroup>

      {/* ── Font Size — elegant range slider ── */}
      <SettingGroup icon={<ALargeSmall size={14} />} label={a.fontSize}>
        <div className="px-1">
          {/* Slider */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground/60 shrink-0" style={{ fontSize: '11px' }}>A</span>
            <input
              type="range"
              min={14}
              max={17}
              step={1}
              value={parseInt(fontSize)}
              onChange={e => setFontSize(`${e.target.value}px`)}
              className="flex-1 h-1.5 rounded-full appearance-none bg-muted cursor-pointer accent-[var(--amber)]
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--amber)]
                [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110
                [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                [&::-moz-range-thumb]:bg-[var(--amber)] [&::-moz-range-thumb]:border-0
                [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:cursor-pointer"
            />
            <span className="text-base text-muted-foreground/60 shrink-0">A</span>
          </div>
          {/* Current value */}
          <div className="text-center mt-1.5">
            <span className="text-xs tabular-nums text-muted-foreground">{parseInt(fontSize)}px</span>
          </div>
          {/* Live preview */}
          <p
            className="text-muted-foreground leading-relaxed mt-2 px-1"
            style={{
              fontSize,
              fontFamily: FONTS.find(f => f.value === font)?.style.fontFamily,
            }}
          >
            {a.fontSizePreview}
          </p>
        </div>
      </SettingGroup>

      {/* ── Content Width — visual width bars ── */}
      <SettingGroup icon={<Columns3 size={14} />} label={a.contentWidth}>
        <div className="space-y-1">
          {CONTENT_WIDTHS.map(w => {
            const selected = contentWidth === w.value;
            return (
              <button
                key={w.value}
                type="button"
                onClick={() => setContentWidth(w.value)}
                className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-all ${
                  selected ? 'bg-[var(--amber-subtle)]' : 'hover:bg-muted/50'
                }`}
              >
                {/* Width indicator bar */}
                <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      selected ? 'bg-[var(--amber)]' : 'bg-muted-foreground/20'
                    }`}
                    style={{ width: `${w.width}%` }}
                  />
                </div>
                {/* Label */}
                <span className={`text-sm shrink-0 w-14 text-right ${
                  selected ? 'text-foreground font-medium' : 'text-muted-foreground'
                }`}>
                  {w.label}
                </span>
              </button>
            );
          })}
        </div>
      </SettingGroup>

      </SettingCard>

      <p className="text-xs text-muted-foreground/40 px-0.5">{a.browserNote}</p>

      {/* ── Labs — experimental features ── */}
      <SettingCard icon={<FlaskConical size={15} />} title={a.labsTitle ?? 'Labs'} description={a.labsDesc ?? 'Experimental features that are still in development.'}>
        <div className="space-y-3">
          <LabsToggle
            label={a.labsEcho ?? 'Echo'}
            description={a.labsEchoDesc ?? 'Reflective journaling powered by your notes.'}
            checked={labsEcho}
            onChange={v => {
              setLabsEcho(v);
              localStorage.setItem('mindos:labs-echo', v ? '1' : '0');
              window.dispatchEvent(new Event('mindos:labs-changed'));
            }}
          />
          <LabsToggle
            label={a.labsWorkflows ?? 'Flows'}
            description={a.labsWorkflowsDesc ?? 'Visual workflow automation for agents.'}
            checked={labsWorkflows}
            onChange={v => {
              setLabsWorkflows(v);
              localStorage.setItem('mindos:labs-workflows', v ? '1' : '0');
              window.dispatchEvent(new Event('mindos:labs-changed'));
            }}
          />
        </div>
      </SettingCard>

      {/* ── Keyboard Shortcuts ── */}
      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setShowShortcuts(!showShortcuts)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showShortcuts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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
