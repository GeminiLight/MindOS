"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  FilePenLine,
  GitBranch,
  Handshake,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type {
  CoevolutionMode,
  CoevolutionTask,
  Inquiry,
} from "@geminilight/mindos/knowledge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import {
  buildWorkspaceProjection,
  compactWorkspaceText,
} from "./workspace-model";
import {
  WORKSPACE_FEATURES,
  workspaceCopy,
  type WorkspaceFeature,
} from "./workspace-copy";
import "./workspace.css";

const icons = {
  decision: GitBranch,
  handoff: UsersRound,
  correction: FilePenLine,
  disagreement: CircleHelp,
  transfer: Layers3,
  experiment: Handshake,
};
export interface CoEvolutionWorkspaceProps {
  task: CoevolutionTask | null;
  tasks: CoevolutionTask[];
  inquiry?: Inquiry | null;
  activeFeature: WorkspaceFeature;
  onFeatureChange: (feature: WorkspaceFeature) => void;
  onSelectTask: (id: string) => void;
  onCreateTask: () => void;
  onModeChange: (mode: CoevolutionMode) => void;
  editor: ReactNode;
  locale: string;
  loading?: boolean;
  error?: string;
  saving?: boolean;
  onRetry?: () => void;
  headerAction?: ReactNode;
  selectedRecordId?: string;
  onSelectRecord?: (feature: WorkspaceFeature, id: string) => void;
  onStartTask?: () => void;
}

export function CoEvolutionWorkspace({
  task,
  tasks,
  inquiry,
  activeFeature,
  onFeatureChange,
  onSelectTask,
  onCreateTask,
  onModeChange,
  editor,
  locale,
  loading = false,
  error,
  saving = false,
  onRetry,
  headerAction,
  selectedRecordId,
  onSelectRecord,
  onStartTask,
}: CoEvolutionWorkspaceProps) {
  const copy = workspaceCopy(locale);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const projection = useMemo(
    () =>
      task
        ? buildWorkspaceProjection(
            task,
            activeFeature,
            locale,
            inquiry,
            selectedRecordId,
          )
        : null,
    [task, activeFeature, locale, inquiry, selectedRecordId],
  );
  const startHere =
    !!onStartTask &&
    activeFeature === "decision" &&
    task?.decisions.length === 0;
  const currentDecision =
    task?.decisions.find((item) => item.id === selectedRecordId) ??
    task?.decisions.at(-1);
  const continueTask =
    !!onStartTask &&
    activeFeature === "decision" &&
    (startHere || !!currentDecision?.outcome);
  const canvasProjection =
    startHere && projection
      ? {
          ...projection,
          action: {
            ...projection.action,
            cta: task?.chatSessionId
              ? locale === "zh"
                ? "继续这次对话"
                : "Continue this conversation"
              : locale === "zh"
                ? "让 Agent 先展开"
                : "Prepare with Agent",
            body:
              locale === "zh"
                ? "先推进真实任务，遇到关键取舍时再一起判断。"
                : "Start the actual task, then decide together at an important tradeoff.",
          },
        }
      : projection;
  useEffect(() => {
    setSourceOpen(false);
    setHistoryOpen(false);
    setArtifactOpen(false);
    setResultOpen(false);
  }, [task?.id]);
  const focusEditor = () => {
    const panel = editorRef.current;
    if (!panel) return;
    const primary = panel.querySelector<HTMLButtonElement>('[data-co-primary-action]');
    if (primary && !primary.disabled) { primary.click(); return; }
    // A canvas action must land on the actual editor, including a progressively disclosed form.
    const form = panel.querySelector("form");
    const disclosure = form?.closest("details");
    if (disclosure) disclosure.open = true;
    panel.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    requestAnimationFrame(() => {
      const controls = panel.querySelectorAll<HTMLElement>(
        "textarea:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),button:not(:disabled)",
      );
      const first = [...controls].find(
        (element) => element.getClientRects().length > 0,
      );
      (first || panel).focus({ preventScroll: true });
    });
  };
  const chooseFeature = (feature: WorkspaceFeature) => {
    onFeatureChange(feature);
  };
  const ActiveIcon = icons[activeFeature];
  const correction =
    task?.corrections.find((item) => item.id === selectedRecordId) ??
    task?.corrections.at(-1);
  const humanDate = (date: string) =>
    new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));

  return (
    <div
      className="co-workspace"
      data-has-task={!!task}
      aria-busy={loading || saving}
    >
      <header className="co-workspace-header">
        <div className="co-workspace-title">
          <span className="co-workspace-eyebrow font-mono">{copy.eyebrow}</span>
          <h1>{task?.title || copy.title}</h1>
          {!task && <p>{copy.subtitle}</p>}
        </div>
        <div className="co-workspace-header-actions">
          {task && (
            <span className="co-save-state" role="status">
              {saving ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
              <span>{saving ? copy.saving : copy.saved}</span>
            </span>
          )}
          <div className="co-header-primary">{headerAction}</div>
          {!!tasks.length && (
            <Button
              className="co-task-switch"
              variant="outline"
              size="lg"
              disabled={saving}
              onClick={() => setPickerOpen(true)}
            >
              <Layers3 size={15} />
              <span>{copy.tasks}</span>
              <ChevronDown size={13} />
            </Button>
          )}
          {task && (
            <Button
              className="co-new-task"
              variant="ghost"
              size="icon-lg"
              aria-label={copy.newTask}
              title={copy.newTask}
              disabled={saving}
              onClick={onCreateTask}
            >
              <Plus size={17} />
            </Button>
          )}
        </div>
      </header>
      {error && (
        <div className="co-workspace-error" role="alert">
          <span>{error}</span>
          {onRetry && (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              <RefreshCw size={13} />
              {copy.retry}
            </Button>
          )}
        </div>
      )}
      {!task ? (
        loading ? (
          <div className="co-workspace-loading" role="status">
            <Loader2 size={24} className="animate-spin" />
            <span>{copy.loading}</span>
          </div>
        ) : (
          <section className="co-workspace-empty">
            <div className="co-empty-diagram" aria-hidden>
              <span>
                <FilePenLine size={22} />
              </span>
              <i />
              <span className="co-empty-center">
                <UsersRound size={29} />
              </span>
              <i />
              <span>
                <Sparkles size={22} />
              </span>
            </div>
            <h2>{copy.emptyTitle}</h2>
            <p>{copy.emptyBody}</p>
            <Button variant="amber" size="xl" onClick={onCreateTask}>
              {copy.emptyAction}
              <ArrowRight size={16} />
            </Button>
            <small>{copy.emptyHint}</small>
          </section>
        )
      ) : (
        projection && (
          <>
            <div className="co-workspace-contextbar">
              <div
                className="co-mode-switch"
                role="group"
                aria-label={copy.modeTitle}
              >
                {(["guide", "together", "try"] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    aria-pressed={task.mode === mode}
                    title={copy.modeHelp[mode]}
                    onClick={() => onModeChange(mode)}
                  >
                    {copy.modes[mode]}
                  </Button>
                ))}
              </div>
              <div className="co-context-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={task.source ? copy.sourceSession : copy.taskNote}
                  onClick={() => setSourceOpen(true)}
                >
                  <ArrowUpRight size={13} />
                  <span>
                    {task.source ? copy.sourceSession : copy.taskNote}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={copy.history}
                  onClick={() => setHistoryOpen(true)}
                >
                  <Clock3 size={13} />
                  <span>{copy.history}</span>
                  {projection.history.length > 0 && (
                    <span className="font-mono">
                      {projection.history.length}
                    </span>
                  )}
                </Button>
              </div>
            </div>
            <div className="co-workspace-stage">
              <div className="co-workspace-map-area">
                <WorkspaceCanvas
                  projection={canvasProjection!}
                  feature={activeFeature}
                  copy={copy}
                  taskId={task.id}
                  onSource={() =>
                    activeFeature === "correction" && correction
                      ? setArtifactOpen(true)
                      : setSourceOpen(true)
                  }
                  onResult={() => setResultOpen(true)}
                  onContinue={continueTask ? onStartTask! : focusEditor}
                />
                <nav
                  className="co-workspace-features"
                  role="tablist"
                  aria-label={
                    locale === "zh"
                      ? "选择此刻需要的协作方式"
                      : "Choose what this task needs now"
                  }
                >
                  {projection.features.map((feature, index) => {
                    const Icon = icons[feature.id];
                    return (
                      <button
                        key={feature.id}
                        ref={(node) => {
                          tabRefs.current[index] = node;
                        }}
                        type="button"
                        role="tab"
                        id={`co-feature-${feature.id}`}
                        aria-controls="co-workspace-editor"
                        aria-selected={feature.id === activeFeature}
                        tabIndex={feature.id === activeFeature ? 0 : -1}
                        className="co-feature-button"
                        onClick={() => chooseFeature(feature.id)}
                        onKeyDown={(event) => {
                          if (
                            ![
                              "ArrowLeft",
                              "ArrowRight",
                              "Home",
                              "End",
                            ].includes(event.key)
                          )
                            return;
                          event.preventDefault();
                          const next =
                            event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? WORKSPACE_FEATURES.length - 1
                                : (index +
                                    (event.key === "ArrowRight" ? 1 : -1) +
                                    WORKSPACE_FEATURES.length) %
                                  WORKSPACE_FEATURES.length;
                          chooseFeature(WORKSPACE_FEATURES[next]);
                          tabRefs.current[next]?.focus();
                        }}
                      >
                        <span className="co-feature-icon">
                          <Icon size={17} />
                          {feature.pending && (
                            <i aria-label={copy.status.waiting} />
                          )}
                        </span>
                        <span>{copy.features[feature.id].label}</span>
                        {feature.count > 0 && (
                          <span className="co-feature-count font-mono">
                            {feature.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>
              <aside
                ref={editorRef}
                className="co-workspace-editor"
                id="co-workspace-editor"
                role="tabpanel"
                aria-labelledby={`co-feature-${activeFeature}`}
                tabIndex={-1}
              >
                <header className="co-editor-header">
                  <span className="co-editor-icon">
                    <ActiveIcon size={17} />
                  </span>
                  <div>
                    <h2>{copy.features[activeFeature].title}</h2>
                    <p>{copy.features[activeFeature].description}</p>
                  </div>
                </header>
                <div className="co-editor-body">{editor}</div>
              </aside>
            </div>
            <footer className="co-workspace-footer">
              <span>
                <ShieldCheck size={12} />
                {copy.local}
              </span>
              <span>
                {copy.updated} {humanDate(task.updatedAt)}
              </span>
            </footer>
          </>
        )
      )}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="co-workspace-dialog">
          <DialogHeader>
            <DialogTitle>{copy.tasks}</DialogTitle>
            <DialogDescription>
              {copy.taskCount(tasks.length)}
            </DialogDescription>
          </DialogHeader>
          <div className="co-task-list">
            {tasks.map((item) => (
              <button
                key={item.id}
                type="button"
                className="co-task-option"
                onClick={() => {
                  onSelectTask(item.id);
                  setPickerOpen(false);
                }}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>{compactWorkspaceText(item.goal, 75)}</small>
                </span>
                {item.id === task?.id ? (
                  <Check size={16} aria-label={copy.selected} />
                ) : (
                  <ArrowRight size={15} />
                )}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="xl"
            onClick={() => {
              setPickerOpen(false);
              onCreateTask();
            }}
          >
            <Plus size={15} />
            {copy.newTask}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent className="co-workspace-dialog co-source-dialog">
          <DialogHeader>
            <DialogTitle>
              {task?.source?.title || task?.title || copy.sourceDialog}
            </DialogTitle>
            <DialogDescription>
              {task?.source ? copy.sourceSession : copy.taskNote}
            </DialogDescription>
          </DialogHeader>
          <div className="co-source-full">
            <h3>{copy.taskNote}</h3>
            <p>{task?.goal}</p>
            {task?.source && (
              <>
                <h3>{copy.sourceSession}</h3>
                {task.source.excerpts?.length ? task.source.excerpts.map((excerpt) => <div key={excerpt.messageId} className="space-y-2">
                  <p className="text-xs text-muted-foreground">{excerpt.role === 'user' ? (locale === 'zh' ? '你当时说' : 'You said') : 'Agent'}</p>
                  <blockquote>{excerpt.quote}</blockquote>
                </div>) : <><blockquote>{task.source.quote}</blockquote>{task.source.question && <p>{task.source.question}</p>}</>}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={artifactOpen} onOpenChange={setArtifactOpen}>
        <DialogContent className="co-workspace-dialog">
          <DialogHeader>
            <DialogTitle>
              {correction?.actor.kind === "agent"
                ? copy.sourceProposal
                : locale === "zh"
                  ? "你改过的那一处"
                  : "The edit you made"}
            </DialogTitle>
            <DialogDescription>
              {correction?.actor.kind === "agent"
                ? copy.status.ready
                : copy.evidenceManual}
            </DialogDescription>
          </DialogHeader>
          <div className="co-artifact-comparison">
            <section>
              <h3>{locale === "zh" ? "修改前" : "Before"}</h3>
              <p>{correction?.before}</p>
            </section>
            <section>
              <h3>
                {correction?.actor.kind === "agent"
                  ? locale === "zh"
                    ? "建议改成"
                    : "Proposed edit"
                  : locale === "zh"
                    ? "修改后"
                    : "After"}
              </h3>
              <p>{correction?.after}</p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className="co-workspace-dialog">
          <DialogHeader>
            <DialogTitle>{projection?.result.title}</DialogTitle>
            <DialogDescription>
              {projection?.result.evidenceLabel}
            </DialogDescription>
          </DialogHeader>
          <div className="co-source-full">
            <p>{projection?.result.body}</p>
            {projection?.result.evidenceQuote && (
              <>
                <h3>{copy.resultDetail}</h3>
                <blockquote>{projection.result.evidenceQuote}</blockquote>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="co-workspace-dialog">
          <DialogHeader>
            <DialogTitle>{copy.history}</DialogTitle>
            <DialogDescription>
              {projection?.history.length
                ? copy.historyCount(projection.history.length)
                : copy.noHistory}
            </DialogDescription>
          </DialogHeader>
          <div className="co-history-list">
            {projection?.history.map((item) => {
              const Icon = icons[item.feature];
              return (
                <button
                  type="button"
                  key={`${item.feature}-${item.id}`}
                  onClick={() => {
                    if (onSelectRecord) onSelectRecord(item.feature, item.id);
                    else chooseFeature(item.feature);
                    setHistoryOpen(false);
                  }}
                  title={copy.openTool}
                >
                  <Icon size={15} />
                  <span>
                    <strong>{compactWorkspaceText(item.title, 95)}</strong>
                    <small>
                      {copy.features[item.feature].label} ·{" "}
                      {humanDate(item.createdAt)}
                    </small>
                  </span>
                  <ArrowRight size={13} />
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
