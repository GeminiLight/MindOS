'use client';

import { X } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { type Messages } from '@/lib/i18n';
import { type CustomProvider } from '@/lib/custom-endpoints';
import { useCustomProviderForm } from './useCustomProviderForm';
import CustomProviderFields from './CustomProviderFields';
import { TestButton } from './TestButton';

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (provider: CustomProvider) => void;
  initialProvider?: CustomProvider;
  existingNames?: string[];
  t: Messages;
}

/**
 * Modal wrapper — renders nothing when closed, remounts inner form
 * on open so hook state resets cleanly.
 */
export default function ProviderModal({
  isOpen, onClose, onSave, initialProvider, existingNames, t,
}: ProviderModalProps) {
  if (!isOpen) return null;

  return (
    <ProviderModalInner
      key={initialProvider?.id ?? '__new__'}
      onClose={onClose}
      onSave={onSave}
      initialProvider={initialProvider}
      existingNames={existingNames}
      t={t}
    />
  );
}

function ProviderModalInner({
  onClose, onSave, initialProvider, existingNames, t,
}: Omit<ProviderModalProps, 'isOpen'>) {
  const { locale } = useLocale();
  const form = useCustomProviderForm({ initial: initialProvider, onSave, locale, existingNames });

  const title = initialProvider
    ? (locale === 'zh' ? '编辑 Provider' : 'Edit Provider')
    : (locale === 'zh' ? '添加 Provider' : 'Add Provider');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-foreground">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-muted rounded transition-colors">
            <X size={16} />
          </button>
        </div>

        <CustomProviderFields form={form} t={t} locale={locale} layout="full" />

        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
          >
            {t.settings?.customProviders?.modal?.buttonCancel ?? 'Cancel'}
          </button>
          <TestButton result={form.testResult} disabled={!form.canSave} onTest={form.handleTest} t={t} />
          <button
            type="button"
            onClick={form.handleSave}
            disabled={!form.canSave}
            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] hover:bg-[var(--amber)]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {locale === 'zh' ? '保存' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
