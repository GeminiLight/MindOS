'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { Trash2, Edit2, Layers } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { type CustomProvider, generateCustomProviderId, isValidProvider } from '@/lib/custom-endpoints';
import { SettingCard } from './Primitives';
import ProviderModal from './ProviderModal';

interface CustomProvidersCardProps {
  providers: CustomProvider[];
  onProvidersChange: (providers: CustomProvider[]) => void;
}

export default function CustomProvidersCard({
  providers,
  onProvidersChange,
}: CustomProvidersCardProps) {
  const { t } = useLocale();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const editingProvider = useMemo(
    () => editingId ? providers.find(p => p.id === editingId) : null,
    [editingId, providers],
  );

  const handleAddClick = useCallback(() => {
    setEditingId(null);
    setIsModalOpen(true);
  }, []);

  const handleEditClick = useCallback((id: string) => {
    setEditingId(id);
    setIsModalOpen(true);
  }, []);

  const handleSaveProvider = useCallback((provider: CustomProvider) => {
    const updated = editingId
      ? providers.map(p => (p.id === editingId ? provider : p))
      : [...providers, provider];
    onProvidersChange(updated);
    setIsModalOpen(false);
  }, [editingId, providers, onProvidersChange]);

  const handleDeleteClick = useCallback((id: string) => {
    setDeleteConfirmId(id);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deleteConfirmId) {
      const updated = providers.filter(p => p.id !== deleteConfirmId);
      onProvidersChange(updated);
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, providers, onProvidersChange]);

  const label = t.settings?.customProviders?.title ?? 'Model Providers';
  const subtitle = t.settings?.customProviders?.subtitle ?? 'Add custom API endpoints with your own names';

  return (
    <>
      <SettingCard icon={<Layers size={15} />} title={label} description={subtitle}>
        <div className="space-y-2">
          {providers.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 px-3 rounded-lg bg-muted/30 text-center">
              {t.settings?.customProviders?.emptyState ?? 'No custom providers yet.'}
            </div>
          ) : (
            providers.map(provider => (
              <div
                key={provider.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:border-border transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{provider.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {provider.protocol} · {provider.model}
                  </div>
                  <div className="text-2xs text-muted-foreground/60 mt-1 truncate font-mono">
                    {provider.baseUrl}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleEditClick(provider.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                    title={t.settings?.customProviders?.editButton}
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteClick(provider.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-border/50 text-muted-foreground hover:text-destructive hover:border-destructive/20 transition-colors"
                    title={t.settings?.customProviders?.deleteButton}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={handleAddClick}
          className="mt-3 text-xs font-medium text-[var(--amber)] hover:text-[var(--amber)]/80 transition-colors"
        >
          {t.settings?.customProviders?.addButton ?? '+ Add Provider'}
        </button>
      </SettingCard>

      <ProviderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveProvider}
        initialProvider={editingProvider ?? undefined}
        t={t}
      />

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overlay-backdrop">
          <div className="bg-card border border-border rounded-lg shadow-lg p-4 max-w-sm mx-4">
            <p className="text-sm font-medium">
              {t.settings?.customProviders?.deleteConfirm?.(
                providers.find(p => p.id === deleteConfirmId)?.name ?? '',
              ) ?? 'Delete this provider?'}
            </p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-3 py-1.5 text-sm rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 px-3 py-1.5 text-sm rounded bg-destructive/10 border border-destructive/20 text-destructive hover:bg-destructive/20 transition-colors"
              >
                {t.settings?.customProviders?.deleteConfirmButton ?? 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
