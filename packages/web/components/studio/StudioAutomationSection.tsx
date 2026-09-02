'use client';

import { Plus } from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  acknowledgeStudioAutomationNotification,
  acknowledgeAllStudioAutomationNotifications,
  createStudioAutomation,
  deleteStudioAutomation,
  fetchStudioAutomations,
  resolveStudioAutomationApproval,
  runStudioAutomationNow,
  setStudioAutomationStatus,
  STUDIO_AUTOMATIONS_UPDATED_EVENT,
  updateStudioAutomation,
  type StudioAutomation,
  type StudioAutomationApproval,
  type StudioAutomationDraft,
  type StudioAutomationNotification,
  type StudioAutomationPayload,
} from '@/lib/studio-automations';
import type { StudioProject } from '@/lib/studio-projects';
import { AutomationOperations } from './StudioAutomationOperations';
import {
  AutomationCard,
  AutomationDrawer,
  AutomationToolbar,
  COPY,
  automationEmptyMessage,
  automationMatchesStatusFilter,
  automationSearchText,
  automationToDraft,
  defaultDraft,
  normalizeSearchValue,
  type AutomationStatusFilter,
} from './StudioAutomationView';

export default function StudioAutomationSection({
  projects,
  locale,
  titleLevel = 2,
  beforeTitle,
}: {
  projects: StudioProject[];
  locale: string;
  titleLevel?: 1 | 2;
  beforeTitle?: ReactNode;
}) {
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const TitleTag = titleLevel === 1 ? 'h1' : 'h2';
  const titleClassName = titleLevel === 1 ? 'text-2xl font-semibold text-foreground' : 'text-sm font-semibold text-foreground';
  const [payload, setPayload] = useState<StudioAutomationPayload | null>(null);
  const [automations, setAutomations] = useState<StudioAutomation[]>([]);
  const [draft, setDraft] = useState<StudioAutomationDraft>(() => defaultDraft(projects));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AutomationStatusFilter>('all');

  const applyPayload = useCallback((nextPayload: StudioAutomationPayload) => {
    setPayload(nextPayload);
    setAutomations(nextPayload.automations);
    setLoadError(null);
  }, []);

  const loadAutomations = useCallback(async () => {
    try {
      applyPayload(await fetchStudioAutomations());
    } catch (nextError) {
      setLoadError(nextError instanceof Error ? nextError.message : copy.loadError);
    }
  }, [applyPayload, copy.loadError]);

  useEffect(() => {
    void loadAutomations();
  }, [loadAutomations]);

  useEffect(() => {
    const syncAutomations = () => { void loadAutomations(); };
    window.addEventListener(STUDIO_AUTOMATIONS_UPDATED_EVENT, syncAutomations);
    window.addEventListener('focus', syncAutomations);
    return () => {
      window.removeEventListener(STUDIO_AUTOMATIONS_UPDATED_EVENT, syncAutomations);
      window.removeEventListener('focus', syncAutomations);
    };
  }, [loadAutomations]);

  useEffect(() => {
    if (!automations.some((automation) => automation.lastStatus === 'running' || automation.lastStatus === 'waiting_approval')
      && !payload?.summary.pendingApprovals) return undefined;
    const timer = window.setTimeout(() => { void loadAutomations(); }, 2_000);
    return () => window.clearTimeout(timer);
  }, [automations, loadAutomations, payload?.summary.pendingApprovals]);

  useEffect(() => {
    setDraft((current) => {
      if (current.projectId || projects.length === 0) return current;
      return { ...current, projectId: projects[0].id };
    });
  }, [projects]);

  const projectOptions = useMemo(() => projects.map((project) => project.id), [projects]);
  const editing = editingId ? automations.find((automation) => automation.id === editingId) : null;
  const normalizedSearchQuery = normalizeSearchValue(searchQuery);
  const searchMatchedAutomations = useMemo(() => {
    if (!normalizedSearchQuery) return automations;
    return automations.filter((automation) => (
      automationSearchText(automation, projects, locale, copy).includes(normalizedSearchQuery)
    ));
  }, [automations, copy, locale, normalizedSearchQuery, projects]);
  const statusCounts = useMemo(() => {
    const enabled = searchMatchedAutomations.filter((automation) => automation.status === 'active').length;
    return {
      all: searchMatchedAutomations.length,
      enabled,
      paused: searchMatchedAutomations.length - enabled,
    };
  }, [searchMatchedAutomations]);
  const filteredAutomations = useMemo(() => (
    searchMatchedAutomations.filter((automation) => automationMatchesStatusFilter(automation, statusFilter))
  ), [searchMatchedAutomations, statusFilter]);
  const emptyMessage = automationEmptyMessage(copy, statusFilter, Boolean(normalizedSearchQuery), automations.length > 0);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setError(null);
    setDraft(defaultDraft(projects));
  }, [projects]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    resetForm();
  }, [resetForm]);

  const openCreate = () => {
    resetForm();
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (!drawerOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDrawer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDrawer, drawerOpen]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.prompt.trim()) {
      setError(copy.required);
      return;
    }
    setError(null);
    const safeDraft: StudioAutomationDraft = {
      ...draft,
      projectId: draft.scope === 'project' ? draft.projectId || projects[0]?.id : undefined,
    };
    setSaving(true);
    try {
      const nextPayload = editingId
        ? await updateStudioAutomation(editingId, safeDraft)
        : await createStudioAutomation(safeDraft);
      applyPayload(nextPayload);
      setDrawerOpen(false);
      resetForm();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : copy.loadError);
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (automation: StudioAutomation) => {
    setEditingId(automation.id);
    setError(null);
    setDraft(automationToDraft(automation, projects));
    setDrawerOpen(true);
  };

  const applyTemplate = (template: Pick<StudioAutomationDraft, 'title' | 'prompt' | 'scope' | 'schedule' | 'effort'>) => {
    setDraft((current) => ({
      ...current,
      ...template,
      projectId: template.scope === 'project' ? current.projectId || projects[0]?.id : current.projectId,
    }));
    setError(null);
  };

  const toggleAutomation = async (automation: StudioAutomation) => {
    setBusyId(automation.id);
    try {
      const nextStatus = automation.status === 'active' ? 'paused' : 'active';
      applyPayload(await setStudioAutomationStatus(automation.id, nextStatus));
    } catch (nextError) {
      setLoadError(nextError instanceof Error ? nextError.message : copy.loadError);
    } finally {
      setBusyId(null);
    }
  };

  const removeAutomation = async (automation: StudioAutomation) => {
    if (typeof window !== 'undefined' && !window.confirm(copy.deleteConfirm)) return;
    setBusyId(automation.id);
    try {
      applyPayload(await deleteStudioAutomation(automation.id));
    } catch (nextError) {
      setLoadError(nextError instanceof Error ? nextError.message : copy.loadError);
    } finally {
      setBusyId(null);
    }
  };

  const runAutomationNow = async (automation: StudioAutomation) => {
    setBusyId(automation.id);
    try {
      applyPayload(await runStudioAutomationNow(automation.id));
    } catch (nextError) {
      setLoadError(nextError instanceof Error ? nextError.message : copy.loadError);
    } finally {
      setBusyId(null);
    }
  };

  const resolveApproval = async (approval: StudioAutomationApproval, decision: 'allow' | 'deny') => {
    setBusyId(approval.id);
    try {
      applyPayload(await resolveStudioAutomationApproval(approval.id, decision));
    } catch (nextError) {
      setLoadError(nextError instanceof Error ? nextError.message : copy.loadError);
    } finally {
      setBusyId(null);
    }
  };

  const dismissNotification = async (notification: StudioAutomationNotification) => {
    setBusyId(notification.id);
    try {
      applyPayload(await acknowledgeStudioAutomationNotification(notification.id));
    } catch (nextError) {
      setLoadError(nextError instanceof Error ? nextError.message : copy.loadError);
    } finally {
      setBusyId(null);
    }
  };

  const dismissAllNotifications = async () => {
    setBusyId('notifications-all');
    try {
      applyPayload(await acknowledgeAllStudioAutomationNotifications());
    } catch (nextError) {
      setLoadError(nextError instanceof Error ? nextError.message : copy.loadError);
    } finally {
      setBusyId(null);
    }
  };

  const templates = [
    {
      title: locale === 'zh' ? '研究雷达' : 'Research radar',
      prompt: locale === 'zh'
        ? '扫描已跟踪方向，筛选强论文，并生成中文研究雷达。'
        : 'Scan tracked directions, promote strong papers, and write the research radar.',
      scope: 'mind' as const,
      schedule: 'daily-0900' as const,
      effort: 'high' as const,
    },
    {
      title: locale === 'zh' ? '项目复盘' : 'Project review',
      prompt: locale === 'zh'
        ? '检查当前项目的待复盘项、最近对话和可沉淀经验。'
        : 'Review the current project, recent sessions, and reusable lessons.',
      scope: 'project' as const,
      schedule: 'weekly-review' as const,
      effort: 'normal' as const,
    },
  ];

  return (
    <section
      data-studio-automation-section
      aria-labelledby="studio-automation-title"
      className="scroll-mt-[calc(var(--app-titlebar-h)+0.75rem)] space-y-6"
    >
      <header className="border-b border-border/60 pb-6">
        {beforeTitle ? <div className="mb-3">{beforeTitle}</div> : null}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <TitleTag id="studio-automation-title" className={titleClassName}>{copy.title}</TitleTag>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy.subtitle}</p>
          </div>
          <Button
            data-studio-automation-create
            type="button"
            onClick={openCreate}
            variant="amber"
            size="lg"
            className="shrink-0"
          >
            <Plus size={15} aria-hidden="true" />
            {copy.create}
          </Button>
        </div>
      </header>

      {payload ? (
        <AutomationOperations
          payload={payload}
          copy={copy}
          busyId={busyId}
          onResolveApproval={resolveApproval}
          onDismissNotification={dismissNotification}
          onDismissAllNotifications={dismissAllNotifications}
        />
      ) : null}

      <section className="space-y-3">
        <AutomationToolbar
          copy={copy}
          counts={statusCounts}
          filter={statusFilter}
          onFilterChange={setStatusFilter}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
        />

        {loadError ? (
          <div className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-xs font-medium text-error">
            {loadError}
          </div>
        ) : null}

        <section data-studio-automation-list className="min-w-0" aria-label={copy.searchLabel}>
          {!payload && !loadError ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/35 px-4 py-8 text-center text-sm text-muted-foreground">
              {copy.loading}
            </div>
          ) : filteredAutomations.length ? (
            <div className="overflow-hidden rounded-lg border border-border/60 bg-background/35">
              {filteredAutomations.map((automation) => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  projects={projects}
                  locale={locale}
                  copy={copy}
                  onEdit={beginEdit}
                  onToggle={toggleAutomation}
                  onDelete={removeAutomation}
                  onRunNow={runAutomationNow}
                  busy={busyId === automation.id}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/35 px-4 py-8 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          )}
        </section>
      </section>

      <AutomationDrawer
        open={drawerOpen}
        editing={editing}
        copy={copy}
        draft={draft}
        projects={projects}
        locale={locale}
        projectOptions={projectOptions}
        templates={templates}
        error={error}
        saving={saving}
        onClose={closeDrawer}
        onSubmit={submit}
        onDraftChange={setDraft}
        onApplyTemplate={applyTemplate}
      />
    </section>
  );
}
