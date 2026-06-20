'use client';

import { Check, Sparkles, X } from 'lucide-react';
import type { AiTabProps } from '../types';
import { useLocale } from '@/lib/stores/locale-store';
import { type Provider } from '@/lib/custom-endpoints';
import { PROVIDER_PRESETS } from '@/lib/agent/providers';
import { useCustomProviderForm } from '../useCustomProviderForm';
import CustomProviderFields from '../CustomProviderFields';
import { TestButton } from '../TestButton';
import { Button } from '@/components/ui/button';

export function CustomProviderForm({
  onSave, onCancel, t, existingNames,
}: {
  onSave: (provider: Provider) => void;
  onCancel: () => void;
  t: AiTabProps['t'];
  existingNames: string[];
}) {
  const { locale } = useLocale();
  const form = useCustomProviderForm({ onSave, locale, existingNames });
  const formTitle = locale === 'zh' ? '添加 Provider' : 'Add Provider';
  const preset = PROVIDER_PRESETS[form.protocol];
  const protocolLabel = locale === 'zh' ? preset.nameZh : preset.name;
  const protocolDescription = locale === 'zh' ? preset.descriptionZh : preset.description;
  const modelSummary = form.model.trim() || preset.defaultModel;

  const missingFields: string[] = [];
  if (!form.model.trim()) missingFields.push(locale === 'zh' ? '模型' : 'Model');
  const validationMessage = form.isDuplicateName
    ? (locale === 'zh' ? '名称已存在' : 'Name already exists')
    : !form.canSave && missingFields.length > 0
      ? (locale === 'zh' ? `需要: ${missingFields.join('、')}` : `Required: ${missingFields.join(', ')}`)
      : '';

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/60 bg-background/60 shadow-[0_1px_2px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
            <Sparkles size={14} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{formTitle}</span>
              <span className="shrink-0 rounded-md bg-background/70 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground ring-1 ring-border/60">
                {protocolLabel}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
              <span className="truncate font-mono">{modelSummary}</span>
              {protocolDescription && (
                <>
                  <span className="text-muted-foreground/45">/</span>
                  <span className="truncate">{protocolDescription}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={locale === 'zh' ? '关闭' : 'Close'}
        >
          <X size={15} />
        </button>
      </div>

      <div className="px-4 py-4">
        <CustomProviderFields form={form} t={t} locale={locale} />
      </div>

      <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <TestButton result={form.testResult} disabled={!form.canSave} onTest={form.handleTest} t={t} />
          {validationMessage && (
            <span className={`truncate text-2xs ${form.isDuplicateName ? 'text-destructive' : 'text-muted-foreground/70'}`}>
              {validationMessage}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {locale === 'zh' ? '取消' : 'Cancel'}
          </button>
          <Button
            variant="amber"
            size="lg"
            type="button"
            onClick={form.handleSave}
            disabled={!form.canSave}
            className="min-w-20 gap-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={14} />
            {locale === 'zh' ? '保存' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
