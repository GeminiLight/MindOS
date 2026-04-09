'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, SkipForward, Plus, Edit2, Trash2, X } from 'lucide-react';
import { type ProviderId, PROVIDER_PRESETS, groupedProviders, ALL_PROVIDER_IDS } from '@/lib/agent/providers';
import { type CustomProvider } from '@/lib/custom-endpoints';
import { useLocale } from '@/lib/stores/locale-store';

interface ProviderSelectProps {
  value: ProviderId | 'skip';
  onChange: (id: ProviderId | 'skip') => void;
  showSkip?: boolean;
  compact?: boolean;
  configuredProviders?: Set<ProviderId>;
  customProviders?: CustomProvider[];
  onAddCustom?: () => void;
  onAddFromPreset?: (id: ProviderId) => void;
  onEditCustom?: (id: string) => void;
  onDeleteCustom?: (id: string) => void;
}

export default function ProviderSelect({
  value, onChange, showSkip = false, compact = false, configuredProviders,
  customProviders, onAddCustom, onAddFromPreset, onEditCustom, onDeleteCustom,
}: ProviderSelectProps) {
  const { locale } = useLocale();
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [showMoreInPanel, setShowMoreInPanel] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const groups = groupedProviders();

  const hasConfigured = configuredProviders && configuredProviders.size > 0;
  const hasCustom = customProviders && customProviders.length > 0;
  const hasCustomSection = onAddCustom != null;

  // In compact settings mode with configured providers: show configured-only list + Add button
  const useConfiguredMode = compact && hasConfigured && !showSkip;

  // Sorted configured provider IDs (current selected first, then alphabetical)
  const configuredIds = useConfiguredMode
    ? ALL_PROVIDER_IDS.filter(id => configuredProviders!.has(id))
    : [];

  // Add panel shows ALL providers as protocol templates (can add multiple of the same type)
  const { primary: primaryItems, more: moreItems } = groups;

  const handleAddSelect = (id: ProviderId) => {
    if (onAddFromPreset) {
      onAddFromPreset(id);
    } else {
      onChange(id);
    }
    setAddPanelOpen(false);
    setShowMoreInPanel(false);
  };

  /* ── Compact tab button (used in configured list and add panel) ── */
  const renderCompactTab = (id: ProviderId, opts?: { inPanel?: boolean }) => {
    const preset = PROVIDER_PRESETS[id];
    const displayName = locale === 'zh' ? preset.nameZh : preset.name;
    const isSelected = value === id;
    const isConfigured = configuredProviders?.has(id);

    return (
      <button
        key={id}
        type="button"
        onClick={() => opts?.inPanel ? handleAddSelect(id) : onChange(id)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm ${
          isSelected && !opts?.inPanel
            ? 'border-[var(--amber)] bg-[var(--amber-subtle)] shadow-sm'
            : 'border-border/50 hover:border-border hover:bg-muted/30'
        }`}
      >
        <span className={`font-medium ${isSelected && !opts?.inPanel ? 'text-foreground' : 'text-muted-foreground'}`}>
          {displayName}
        </span>
        {isConfigured && !isSelected && !opts?.inPanel && (
          <CheckCircle2 size={12} className="text-success ml-auto shrink-0" />
        )}
        {isSelected && !opts?.inPanel && (
          <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: 'var(--amber)' }} />
        )}
      </button>
    );
  };

  /* ── Full card button (used in setup wizard / non-compact) ── */
  const renderCard = (id: ProviderId) => {
    const preset = PROVIDER_PRESETS[id];
    const displayName = locale === 'zh' ? preset.nameZh : preset.name;
    const description = locale === 'zh' ? preset.descriptionZh : preset.description;
    const isSelected = value === id;
    const isConfigured = configuredProviders?.has(id);

    return (
      <button
        key={id}
        type="button"
        onClick={() => onChange(id)}
        className="flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-150"
        style={{
          background: isSelected ? 'var(--amber-dim)' : 'var(--card)',
          borderColor: isSelected ? 'var(--amber)' : 'var(--border)',
        }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{displayName}</p>
          {description && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{description}</p>
          )}
          <p className={`text-xs ${description ? 'mt-1' : 'mt-0.5'}`} style={{ color: 'var(--muted-foreground)' }}>
            {preset.defaultModel}
          </p>
        </div>
        {isConfigured && !isSelected && (
          <CheckCircle2 size={14} className="text-success shrink-0 mt-0.5" />
        )}
        {isSelected && (
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--amber)' }} />
        )}
      </button>
    );
  };

  /* ── Custom provider row (used in add panel) ── */
  const renderCustomItem = (cp: CustomProvider) => (
    <div
      key={cp.id}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm border-border/50 hover:border-border hover:bg-muted/30 transition-all group"
    >
      <div className="flex-1 min-w-0">
        <span className="font-medium text-muted-foreground">{cp.name}</span>
        <span className="text-xs text-muted-foreground/50 ml-2">{cp.model}</span>
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {onEditCustom && (
          <button
            type="button"
            onClick={() => onEditCustom(cp.id)}
            className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Edit2 size={12} />
          </button>
        )}
        {onDeleteCustom && (
          <button
            type="button"
            onClick={() => setDeleteConfirmId(cp.id)}
            className="p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/8 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );

  /* ════════════════════════════════════════════
   *  MODE 1: Configured-only list + Add button
   *  (compact settings, has configured providers)
   * ════════════════════════════════════════════ */
  if (useConfiguredMode) {
    return (
      <div className="space-y-2">
        {/* Configured providers row */}
        <div className="flex flex-wrap gap-2">
          {configuredIds.map(id => renderCompactTab(id))}

          {/* Custom providers in the configured list */}
          {customProviders?.map(cp => {
            const isSelected = value === cp.id;
            return (
              <button
                key={cp.id}
                type="button"
                onClick={() => onChange(cp.id as ProviderId)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm ${
                  isSelected
                    ? 'border-[var(--amber)] bg-[var(--amber-subtle)] shadow-sm'
                    : 'border-border/50 hover:border-border hover:bg-muted/30'
                }`}
              >
                <span className={`font-medium ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {cp.name}
                </span>
                {isSelected && (
                  <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: 'var(--amber)' }} />
                )}
              </button>
            );
          })}

          {/* Add button */}
          <button
            type="button"
            onClick={() => { setAddPanelOpen(!addPanelOpen); setShowMoreInPanel(false); }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-all ${
              addPanelOpen
                ? 'border-border bg-muted/50 text-foreground'
                : 'border-dashed border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <Plus size={14} />
            <span>{locale === 'zh' ? '添加' : 'Add'}</span>
          </button>
        </div>

        {/* Add panel (expanded inline) */}
        {addPanelOpen && (
          <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground">
                {locale === 'zh' ? '添加 Provider' : 'Add Provider'}
              </span>
              <button
                type="button"
                onClick={() => { setAddPanelOpen(false); setShowMoreInPanel(false); }}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={12} />
              </button>
            </div>
            <div className="p-3 space-y-2">
              {/* Protocol templates — primary */}
              <div className="flex flex-wrap gap-2">
                {primaryItems.map(id => renderCompactTab(id, { inPanel: true }))}
              </div>

              {/* More toggle */}
              {moreItems.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowMoreInPanel(!showMoreInPanel)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
                  >
                    <ChevronDown size={12} className={`transition-transform ${showMoreInPanel ? 'rotate-180' : ''}`} />
                    {showMoreInPanel
                      ? (locale === 'zh' ? '收起' : 'Less')
                      : (locale === 'zh' ? `更多 (${moreItems.length})` : `More (${moreItems.length})`)}
                  </button>
                  {showMoreInPanel && (
                    <div className="flex flex-wrap gap-2">
                      {moreItems.map(id => renderCompactTab(id, { inPanel: true }))}
                    </div>
                  )}
                </>
              )}

              {/* Add custom provider button */}
              {hasCustomSection && (
                <div className="pt-1 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => { onAddCustom!(); setAddPanelOpen(false); }}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1"
                  >
                    <Plus size={12} />
                    {locale === 'zh' ? '自定义 Provider' : 'Custom Provider'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        {deleteConfirmId && onDeleteCustom && (
          <DeleteConfirm
            name={customProviders?.find(p => p.id === deleteConfirmId)?.name}
            locale={locale}
            onCancel={() => setDeleteConfirmId(null)}
            onConfirm={() => { onDeleteCustom(deleteConfirmId); setDeleteConfirmId(null); }}
          />
        )}
      </div>
    );
  }

  /* ════════════════════════════════════════════
   *  MODE 2: Full list (setup wizard / no configured providers)
   *  Original behavior preserved
   * ════════════════════════════════════════════ */

  return (
    <div className="space-y-2">
      {/* Primary providers */}
      <div className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-1 gap-2'}>
        {primaryItems.map(id => compact ? renderCompactTab(id) : renderCard(id))}
      </div>

      {/* More toggle */}
      {(moreItems.length > 0 || hasCustomSection) && (
        <>
          <button
            type="button"
            onClick={() => setAddPanelOpen(!addPanelOpen)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <ChevronDown size={12} className={`transition-transform ${addPanelOpen ? 'rotate-180' : ''}`} />
            {addPanelOpen
              ? (locale === 'zh' ? '收起' : 'Show less')
              : (locale === 'zh'
                  ? `更多${hasCustom ? ` (${moreItems.length + customProviders!.length})` : moreItems.length > 0 ? ` (${moreItems.length})` : ''}`
                  : `More${hasCustom ? ` (${moreItems.length + customProviders!.length})` : moreItems.length > 0 ? ` (${moreItems.length})` : ''}`)}
          </button>

          {addPanelOpen && (
            <div className="space-y-2">
              {moreItems.length > 0 && (
                <div className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-1 gap-2'}>
                  {moreItems.map(id => compact ? renderCompactTab(id) : renderCard(id))}
                </div>
              )}

              {hasCustomSection && (
                <div className="space-y-2">
                  {hasCustom && (
                    <div className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-1 gap-2'}>
                      {customProviders!.map(renderCustomItem)}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={onAddCustom}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1"
                  >
                    <Plus size={12} />
                    {locale === 'zh' ? '自定义 Provider' : 'Custom Provider'}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Skip option — only in onboarding */}
      {showSkip && (
        <button
          type="button"
          onClick={() => onChange('skip')}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm w-full mt-1"
          style={{
            background: value === 'skip' ? 'var(--amber-dim)' : 'var(--card)',
            borderColor: value === 'skip' ? 'var(--amber)' : 'var(--border)',
          }}
        >
          <SkipForward size={14} className="shrink-0" style={{ color: value === 'skip' ? 'var(--amber)' : 'var(--muted-foreground)' }} />
          <span className={`font-medium ${value === 'skip' ? 'text-foreground' : 'text-muted-foreground'}`}>
            {locale === 'zh' ? '暂时跳过' : 'Skip for now'}
          </span>
          {value === 'skip' && (
            <CheckCircle2 size={14} className="ml-auto shrink-0" style={{ color: 'var(--amber)' }} />
          )}
        </button>
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && onDeleteCustom && (
        <DeleteConfirm
          name={customProviders?.find(p => p.id === deleteConfirmId)?.name}
          locale={locale}
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={() => { onDeleteCustom(deleteConfirmId); setDeleteConfirmId(null); }}
        />
      )}
    </div>
  );
}

/* ── Shared delete confirmation ── */
function DeleteConfirm({ name, locale, onCancel, onConfirm }: {
  name?: string; locale: string; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-destructive/20 bg-destructive/5">
      <span className="text-xs text-destructive flex-1">
        {locale === 'zh' ? `删除 "${name}"？` : `Delete "${name}"?`}
      </span>
      <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded transition-colors">
        {locale === 'zh' ? '取消' : 'Cancel'}
      </button>
      <button type="button" onClick={onConfirm} className="text-xs text-destructive font-medium hover:bg-destructive/10 px-2 py-0.5 rounded transition-colors">
        {locale === 'zh' ? '删除' : 'Delete'}
      </button>
    </div>
  );
}
