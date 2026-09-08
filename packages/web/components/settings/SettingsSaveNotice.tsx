'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { Button } from '@/components/ui/button';
import type { Tab } from './types';
import { useSettingsDraft } from './useSettingsDraft';
import { settingsDraftStore } from './settings-draft';

export default function SettingsSaveNotice({ editing, onOpen }: { editing: boolean; onOpen: (tab: Tab) => void }) {
  const draft = useSettingsDraft();
  const { t } = useLocale();
  if (editing || !draft.pending || !draft.hasFailed) return null;
  const retrying = draft.status === 'saving';
  return (
    <section className="sticky top-0 z-20 border-b border-error/30 bg-card px-4 py-2 md:px-6" data-settings-save-notice>
      <div className="flex flex-col items-stretch justify-between gap-x-4 gap-y-1 sm:flex-row sm:items-center">
        <div role={retrying ? 'status' : 'alert'} className="flex min-w-0 flex-1 items-start gap-2 py-1">
          {retrying ? <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" /> : <AlertCircle size={16} className="mt-0.5 shrink-0 text-error" />}
          <div>
            <p className="text-sm font-medium text-foreground">{retrying ? t.settings.retryingSaveNotice : t.settings.unsavedNotice}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t.settings.unsavedNoticeHint}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" className="min-h-11" onClick={() => onOpen(draft.tab)}>{t.settings.reviewUnsaved}</Button>
          <Button variant="outline" className="min-h-11" disabled={retrying} onClick={() => { void settingsDraftStore.flush(); }}>{t.settings.retrySave}</Button>
        </div>
      </div>
    </section>
  );
}
