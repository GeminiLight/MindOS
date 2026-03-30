'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { BookOpen, Rocket, Brain, Keyboard, HelpCircle, Bot, ChevronDown, Copy, Check } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';

/* ── Collapsible Section ── */
function Section({ id, icon, title, defaultOpen = false, children }: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div id={id} className="bg-card border border-border rounded-lg overflow-hidden scroll-mt-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/50 transition-colors focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <span className="text-[var(--amber)]">{icon}</span>
        <span className="text-base font-medium font-display text-foreground flex-1">{title}</span>
        <ChevronDown size={16} className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-0">
          <div className="border-t border-border pt-4">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Step Card ── */
function StepCard({ step, title, desc }: { step: number; title: string; desc: string }) {
  return (
    <div className="flex gap-4 items-start">
      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold font-mono bg-[var(--amber-dim)] text-[var(--amber)]">
        {step}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

/* ── Copyable Prompt Block ── */
function PromptBlock({ text, copyLabel }: { text: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const clean = text.replace(/^["“]|["”]$/g, '');
    copyToClipboard(clean).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        toast.copy();
      }
    });
  }, [text]);

  return (
    <div className="group/prompt mt-2 flex items-start gap-2 bg-background border border-border rounded-md px-3 py-2">
      <p className="flex-1 text-xs font-mono leading-relaxed text-[var(--amber)]">{text}</p>
      <button
        onClick={handleCopy}
        className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover/prompt:opacity-100 focus-visible:opacity-100"
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/* ── FAQ Item ── */
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-3 text-left focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-foreground pr-4">{q}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <p className="text-sm text-muted-foreground pb-3 leading-relaxed">{a}</p>
      )}
    </div>
  );
}

/* ── Shortcut Row ── */
function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {keys.split(' ').map((key, i) => (
          <kbd
            key={i}
            className="px-1.5 py-0.5 text-xs rounded border border-border bg-muted text-muted-foreground font-mono min-w-[24px] text-center"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}

/* ── Main Component ── */
export default function HelpContent() {
  const { t } = useLocale();
  const h = t.help;

  const [mod, setMod] = useState('⌘');
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    setMod(isMac ? '⌘' : 'Ctrl');
  }, []);

  const shortcuts = useMemo(() => [
    { keys: `${mod} K`, label: h.shortcuts.search },
    { keys: `${mod} /`, label: h.shortcuts.askAI },
    { keys: `${mod} ,`, label: h.shortcuts.settings },
    { keys: `${mod} ?`, label: h.shortcuts.shortcutPanel },
    { keys: 'E', label: h.shortcuts.editFile },
    { keys: `${mod} S`, label: h.shortcuts.save },
    { keys: 'Esc', label: h.shortcuts.closePanel },
    { keys: '@', label: h.shortcuts.attachFile },
  ], [mod, h.shortcuts]);

  const tocItems = useMemo(() => [
    { id: 'what-is', label: h.whatIs.title },
    { id: 'concepts', label: h.concepts.title },
    { id: 'quick-start', label: h.quickStart.title },
    { id: 'agent-usage', label: h.agentUsage.title },
    { id: 'shortcuts', label: h.shortcutsTitle },
    { id: 'faq', label: h.faq.title },
  ], [h]);

  const [activeSection, setActiveSection] = useState('');
  useEffect(() => {
    const ids = tocItems.map(i => i.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 },
    );
    const timer = setTimeout(() => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      }
    }, 100);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [tocItems]);

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-12 relative">
      {/* ── Floating TOC (wide screens only) ── */}
      <nav className="hidden xl:block fixed top-24 w-44" style={{ left: 'calc(50% + 340px)' }} aria-label="Table of contents">
        <ul className="space-y-1 border-l border-border pl-3">
          {tocItems.map(item => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`block text-xs py-1 transition-colors ${
                  activeSection === item.id
                    ? 'text-[var(--amber)] font-medium border-l-2 border-[var(--amber)] -ml-[13px] pl-[11px]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {/* ── Header ── */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1 h-6 rounded-full bg-[var(--amber)]" />
          <h1 className="text-2xl font-bold font-display text-foreground">{h.title}</h1>
        </div>
        <p className="text-muted-foreground text-sm ml-3 mt-1">{h.subtitle}</p>
      </div>

      {/* ── Sections ── */}
      <div className="space-y-3">
        {/* 1. What is MindOS */}
        <Section id="what-is" icon={<BookOpen size={18} />} title={h.whatIs.title} defaultOpen>
          <p className="text-sm text-muted-foreground leading-relaxed">{h.whatIs.body}</p>
        </Section>

        {/* 2. Core Concepts */}
        <Section id="concepts" icon={<Brain size={18} />} title={h.concepts.title} defaultOpen>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">{h.concepts.spaceTitle}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{h.concepts.spaceDesc}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{h.concepts.instructionTitle}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{h.concepts.instructionDesc}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{h.concepts.skillTitle}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{h.concepts.skillDesc}</p>
            </div>
          </div>
        </Section>

        {/* 3. Quick Start */}
        <Section id="quick-start" icon={<Rocket size={18} />} title={h.quickStart.title} defaultOpen>
          <div className="space-y-4">
            <StepCard step={1} title={h.quickStart.step1Title} desc={h.quickStart.step1Desc} />
            <StepCard step={2} title={h.quickStart.step2Title} desc={h.quickStart.step2Desc} />
            <StepCard step={3} title={h.quickStart.step3Title} desc={h.quickStart.step3Desc} />
          </div>
        </Section>

        {/* 4. Using MindOS with AI Agents */}
        <Section id="agent-usage" icon={<Bot size={18} />} title={h.agentUsage.title} defaultOpen>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">{h.agentUsage.intro}</p>

          <div className="space-y-3">
            {h.agentUsage.scenarios.map((sc, i) => {
              const prompts = sc.prompt.split('\n');
              return (
                <div key={i} className="bg-muted/50 rounded-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none" role="img" suppressHydrationWarning>{sc.emoji}</span>
                    <p className="text-sm font-medium text-foreground">{sc.title}</p>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{sc.desc}</p>
                  {prompts.map((p, j) => (
                    <PromptBlock key={j} text={p} copyLabel={h.agentUsage.copy} />
                  ))}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground mt-4">{h.agentUsage.hint}</p>
        </Section>

        {/* 5. Keyboard Shortcuts */}
        <Section id="shortcuts" icon={<Keyboard size={18} />} title={h.shortcutsTitle}>
          <div className="space-y-0">
            {shortcuts.map((s) => (
              <ShortcutRow key={s.keys} keys={s.keys} label={s.label} />
            ))}
          </div>
        </Section>

        {/* 6. FAQ */}
        <Section id="faq" icon={<HelpCircle size={18} />} title={h.faq.title}>
          <div>
            {h.faq.items.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
