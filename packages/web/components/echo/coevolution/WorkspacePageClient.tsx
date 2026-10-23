"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSmoothRouterPush } from "@/hooks/useSmoothRouterPush";
import type {
  CoevolutionTask,
  InquiryRun,
  LearningLoop,
} from "@geminilight/mindos/knowledge";
import { useLocale } from "@/lib/stores/locale-store";
import { openAskModal } from "@/hooks/useAskModal";
import { openTab } from "@/lib/workspace-tabs";
import { offerTaskDraft } from '@/lib/chat-task-draft';
import { AgentAssistance } from './AgentAssistance';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CoEvolutionWorkspace } from "./CoEvolutionWorkspace";
import type { WorkspaceFeature } from "./workspace-copy";
import { DecisionEditor } from "./DecisionEditor";
import { CorrectionEditor } from "./CorrectionEditor";
import { TransferEditor } from "./TransferEditor";
import { ExperimentEditor } from "./ExperimentEditor";
import { DisagreementEditor } from "./DisagreementEditor";
import { HandoffEditor } from "./HandoffEditor";
import { DraftForm, Field, control, note, say } from "./editor-shared";
import {
  WorkspaceError,
  workspaceError,
  workspaceRequest,
  type WorkspaceView,
} from "./workspace-client";

const endpoint = "/api/echo/coevolution";
type Pending = { path: string; body: Record<string, unknown>; method: string };
type StoryChoice = {
  id: string;
  title: string;
  summary: string;
  source: { runtime: string };
};

function WorkspaceController() {
  const push = useSmoothRouterPush();
  function openConversation(sessionId: string, title: string) {
    openTab('chat', sessionId, title, { pinned: true });
    push('/chat/' + encodeURIComponent(sessionId));
  }
  const { locale } = useLocale();
  const latestLocale = useRef(locale);
  latestLocale.current = locale;
  const params = useSearchParams();
  const [view, setView] = useState<WorkspaceView>({});
  const [tasks, setTasks] = useState<CoevolutionTask[]>([]);
  const [feature, setFeature] = useState<WorkspaceFeature>("decision");
  const [record, setRecord] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(!!params.get("sourceStory"));
  const [stories, setStories] = useState<StoryChoice[]>([]),
    [sourceLoading, setSourceLoading] = useState(false),
    [sourceError, setSourceError] = useState("");
  const [inquiryRuns, setInquiryRuns] = useState<InquiryRun[]>([]);
  const [notice, setNotice] = useState("");
  const [deliveryRetry, setDeliveryRetry] = useState<Pending | null>(null);
  const pending = useRef<Pending | null>(null),
    lock = useRef(false),
    alive = useRef(true),
    generation = useRef(0);
  const current = useRef(view.task);
  current.current = view.task;
  const task = view.task ?? null;

  function accept(data: WorkspaceView) {
    if (!alive.current) return;
    if (data.task && data.runs)
      data = { ...data, task: { ...data.task, runs: data.runs } };
    setView(data);
    if (data.task) {
      current.current = data.task;
      setTasks((previous) => [
        data.task!,
        ...previous.filter((t) => t.id !== data.task!.id),
      ]);
    }
    if (data.tasks) setTasks(data.tasks);
  }
  const load = useCallback(
    async (id?: string, background = false) => {
      if (lock.current) return;
      const sequence = ++generation.current;
      if (!background) {
        setLoading(true);
        setError("");
      }
      try {
        let data = await workspaceRequest(
          endpoint + (id ? "?id=" + encodeURIComponent(id) : ""),
        );
        if (sequence !== generation.current || !alive.current) return;
        if (data.tasks) {
          setTasks(data.tasks);
          if (data.tasks.length && !id)
            data = await workspaceRequest(endpoint + "?id=" + data.tasks[0].id);
        }
        if (sequence !== generation.current || !alive.current) return;
        accept(data);
      } catch (e) {
        if (alive.current && sequence === generation.current && !background)
          setError(workspaceError(e, latestLocale.current, "load"));
      } finally {
        if (alive.current && sequence === generation.current) setLoading(false);
      }
    },
    [locale],
  );
  useEffect(() => {
    alive.current = true;
    void load(params.get("task") ?? undefined);
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []); // Initial task identity comes from this URL.
  useEffect(() => {
    const refresh = () => {
      if (!pending.current && !lock.current && current.current)
        void load(current.current.id, true);
    };
    window.addEventListener("focus", refresh);
    // The Agent can update the task while its panel is open. Poll only a bound task.
    const timer = task?.chatSessionId
      ? window.setInterval(refresh, 8000)
      : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      if (timer) window.clearInterval(timer);
    };
  }, [task?.chatSessionId, load]);
  useEffect(() => {
    if (!view.inquiry) {
      setInquiryRuns([]);
      return;
    }
    const abort = new AbortController();
    void workspaceRequest<{ runs: InquiryRun[] }>(
      "/api/echo/inquiries?id=" + view.inquiry.id,
      undefined,
      "GET",
      abort.signal,
    )
      .then((data) => {
        if (!abort.signal.aborted) setInquiryRuns(data.runs ?? []);
      })
      .catch(() => {
        if (!abort.signal.aborted) setInquiryRuns([]);
      });
    return () => abort.abort();
  }, [view.inquiry?.id, view.inquiry?.version]);
  useEffect(() => {
    if (!createOpen || stories.length) return;
    const abort = new AbortController();
    setSourceLoading(true);
    setSourceError("");
    void workspaceRequest<{ stories: StoryChoice[] }>(
      "/api/echo/replays?runtime=codex",
      undefined,
      "GET",
      abort.signal,
    )
      .then((data) => {
        if (!abort.signal.aborted) setStories(data.stories ?? []);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setSourceError(workspaceError(e, locale));
      })
      .finally(() => {
        if (!abort.signal.aborted) setSourceLoading(false);
      });
    return () => abort.abort();
  }, [createOpen, locale]);

  async function send(operation: Pending): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    setNotice("");
    pending.current = operation;
    try {
      const data = await workspaceRequest<
        WorkspaceView & { loop?: LearningLoop }
      >(operation.path, operation.body, operation.method);
      if (!alive.current) return false;
      if (operation.path === endpoint) accept(data);
      else if (current.current)
        accept(await workspaceRequest(endpoint + "?id=" + current.current.id));
      pending.current = null;
      if (data.decisionDelivery) {
        const status = data.decisionDelivery.status;
        setDeliveryRetry(status === "unavailable" ? operation : null);
        setNotice(
          status === "delivered" || status === "already-delivered"
            ? say(
                latestLocale.current,
                "选择已送达，Agent 可以继续。",
                "Choice delivered. The Agent can continue.",
              )
            : status === "unavailable"
              ? say(
                  latestLocale.current,
                  "选择已保存，暂未送达。可以重试递送。",
                  "Choice saved but not delivered yet. You can retry delivery.",
                )
              : say(
                  latestLocale.current,
                  "选择已保存；原提问已结束，可以回到对话继续。",
                  "Choice saved. The original question has ended; continue in the conversation.",
                ),
        );
      }
      if (data.draft) {
        const targetSession = data.draft.chatSessionId ?? (operation.path === '/api/echo/inquiries' ? current.current?.chatSessionId : undefined);
        if (targetSession) {
          const queued = offerTaskDraft(targetSession, data.draft.prompt);
          openConversation(targetSession, data.task?.title ?? current.current?.title ?? '');
          setNotice(queued ? say(locale, '已带回原对话，核对并发送后执行。', 'Ready in the original conversation. Review and send to run.') : say(locale, '原对话已有待发送的请求，请先核对。', 'The conversation already has a pending request. Review it first.'));
        } else { openAskModal(
          data.draft.prompt,
          "user",
          { id: "mindos", name: "MindOS", kind: "mindos" },
          { newSession: true },
        );
        setNotice(
          say(
            locale,
            "任务已准备好，发送后开始实际执行。",
            "Task prepared. Send it to begin the actual run.",
          ),
        );
        }
      }
      if (operation.method === "POST" && data.task) {
        setCreateOpen(false);
        setFeature("decision");
        setRecord("");
        window.history.replaceState(
          null,
          "",
          "/echo/workspace?task=" + data.task.id,
        );
      }
      return true;
    } catch (e) {
      if (alive.current) {
        setError(workspaceError(e, latestLocale.current));
        // Invalid input has definitely not committed; permit correcting and resubmitting it.
        if (
          e instanceof WorkspaceError &&
          ["invalid", "not-found"].includes(e.code)
        )
          pending.current = null;
      }
      return false;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function mutate(command: Record<string, unknown>) {
    const selected = current.current;
    if (!selected || pending.current) return false;
    return send({
      path: endpoint,
      method: "PATCH",
      body: {
        id: selected.id,
        version: selected.version,
        requestId: crypto.randomUUID(),
        ...command,
      },
    });
  }
  async function learningMutation(
    loop: LearningLoop,
    command: Record<string, unknown>,
  ) {
    if (pending.current) return false;
    return send({
      path: "/api/echo/learning",
      method: "PATCH",
      body: { id: loop.id, version: loop.version, ...command },
    });
  }
  async function inquiryMutation(command: Record<string, unknown>) {
    if (!view.inquiry || pending.current) return false;
    return send({
      path: "/api/echo/inquiries",
      method: "PATCH",
      body: {
        id: view.inquiry.id,
        version: view.inquiry.version,
        requestId: crypto.randomUUID(),
        ...command,
      },
    });
  }
  function selectTask(id: string) {
    if (lock.current || pending.current) return;
    setRecord("");
    setFeature("decision");
    setNotice("");
    setDeliveryRetry(null);
    window.history.replaceState(null, "", "/echo/workspace?task=" + id);
    void load(id);
  }
  const disabled = busy || !!pending.current;
  const start = () => {
    if (disabled) return;
    if (task?.chatSessionId && task.decisions.some(d => !d.outcome))
      openConversation(task.chatSessionId, task.title);
    else void mutate({ action: "prepare", intent: task?.decisions.length ? 'continue' : 'decision' });
  };
  const common = task ? { task, locale, busy: disabled, mutate } : null;
  const editor = common ? (
    feature === "decision" ? (
      <DecisionEditor
        {...common}
        selectedRecordId={record}
        onSelectRecord={setRecord}
      />
    ) : feature === "handoff" ? (
      <HandoffEditor {...common} start={() => void mutate({ action: 'prepare', intent: 'handoff' })} />
    ) : feature === "correction" ? (
      <CorrectionEditor
        {...common}
        selectedRecordId={record}
        onSelectRecord={setRecord}
        loops={view.learningLoops ?? []}
        learningMutation={learningMutation}
      />
    ) : feature === "disagreement" ? (
      <DisagreementEditor
        {...common}
        inquiry={view.inquiry}
        runs={inquiryRuns}
        inquiryMutation={inquiryMutation}
      />
    ) : feature === "transfer" ? (
      <TransferEditor {...common} methods={view.methods ?? []} />
    ) : (
      <ExperimentEditor
        {...common}
        selectedRecordId={record}
        onSelectRecord={setRecord}
      />
    )
  ) : null;
  const initialStory = stories.find((s) => s.id === params.get("sourceStory"));
  return (
    <>
      <CoEvolutionWorkspace
        task={task}
        tasks={tasks}
        inquiry={view.inquiry}
        activeFeature={feature}
        selectedRecordId={record}
        onSelectRecord={(f, id) => {
          setFeature(f);
          setRecord(id);
        }}
        onFeatureChange={(f) => {
          setFeature(f);
          setRecord("");
        }}
        onSelectTask={selectTask}
        onCreateTask={() => setCreateOpen(true)}
        onModeChange={(mode) => {
          if (mode !== task?.mode) void mutate({ action: "set-mode", mode });
        }}
        locale={locale}
        loading={loading}
        saving={busy}
        error={error}
        onStartTask={start}
        onRetry={() =>
          pending.current ? void send(pending.current) : void load(task?.id)
        }
        headerAction={
          task ? (
            <Button variant="outline" disabled={disabled} onClick={() => task.chatSessionId ? openConversation(task.chatSessionId, task.title) : start()}>
              {task.chatSessionId
                ? say(locale, "返回对话", "Open conversation")
                : say(locale, "准备协作", "Prepare to collaborate")}
            </Button>
          ) : null
        }
        editor={
          <>
            {notice ? (
              <div className="mb-4 space-y-2">
                <p role="status" className={note}>
                  {notice}
                </p>
                {deliveryRetry ? (
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() => void send(deliveryRetry)}
                  >
                    {say(locale, "重试递送", "Retry delivery")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {error && pending.current ? (
              <Button
                variant="outline"
                className="mb-4"
                disabled={busy}
                onClick={() => {
                  pending.current = null;
                  void load(task?.id);
                }}
              >
                {say(locale, "重新载入，保留草稿", "Reload and keep draft")}
              </Button>
            ) : null}
            {task && <AgentAssistance task={task} feature={feature} inquiry={view.inquiry} locale={locale} busy={disabled} request={intent => void mutate({ action: 'prepare', intent })} />}
            {editor}
          </>
        }
      />
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!busy) setCreateOpen(open);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {say(locale, "带一件真实的事进来", "Bring in real work")}
            </DialogTitle>
            <DialogDescription>
              {say(
                locale,
                "从已有剧情接着做，或写下现在需要完成的任务。",
                "Continue from a real session, or describe the task you want to work on.",
              )}
            </DialogDescription>
          </DialogHeader>
          {sourceLoading ? (
            <p role="status" className={note}>
              {say(
                locale,
                "正在读取已有剧情，新任务可以直接填写。",
                "Loading saved stories. You can already describe a new task.",
              )}
            </p>
          ) : null}
          <DraftForm
            key={initialStory?.id ?? "new"}
            id={"new-task:" + (initialStory?.id ?? "blank")}
            locale={locale}
            busy={disabled}
            submitLabel={say(locale, "进入工作画布", "Open the workspace")}
            initial={{
              title: initialStory?.title ?? "",
              goal: initialStory?.summary ?? "",
              storyId: initialStory?.id ?? "",
              mode: "together",
            }}
            onSubmit={(v) => {
              if (pending.current) return Promise.resolve(false);
              return send({
                path: endpoint,
                method: "POST",
                body: {
                  requestId: crypto.randomUUID(),
                  title: v.title,
                  goal: v.goal,
                  mode: v.mode,
                  ...(v.storyId ? { storyId: v.storyId } : {}),
                },
              });
            }}
          >
            {(v, change) => (
              <>
                {sourceError ? (
                  <p role="alert" className={note}>
                    {say(
                      locale,
                      "已有剧情暂时读不到；仍可创建新任务。",
                      "Saved stories are unavailable; you can still start a new task.",
                    )}
                  </p>
                ) : null}
                <label className="block space-y-2 text-sm">
                  <span>{say(locale, "从哪里开始", "Starting point")}</span>
                  <select
                    className={control}
                    name="storyId"
                    value={v.storyId}
                    onChange={(e) => {
                      const story = stories.find(
                        (s) => s.id === e.target.value,
                      );
                      change({
                        ...v,
                        storyId: e.target.value,
                        ...(story
                          ? { title: story.title, goal: story.summary }
                          : {}),
                      });
                    }}
                  >
                    <option value="">
                      {say(locale, "我现在的新任务", "A new task")}
                    </option>
                    {stories.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.source.runtime} · {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  name="title"
                  label={say(
                    locale,
                    "给这件事起个简短名字",
                    "A short name for this task",
                  )}
                  value={v}
                  change={change}
                  rows={1}
                  max={200}
                />
                <Field
                  name="goal"
                  label={say(
                    locale,
                    "这次希望完成什么",
                    "What do you want to accomplish?",
                  )}
                  value={v}
                  change={change}
                  rows={3}
                  max={4000}
                />
                <label className="block space-y-2 text-sm">
                  <span>
                    {say(locale, "这次怎样配合", "How to work together")}
                  </span>
                  <select
                    name="mode"
                    className={control}
                    value={v.mode}
                    onChange={(e) => change({ ...v, mode: e.target.value })}
                  >
                    <option value="together">
                      {say(locale, "一起做", "Together")}
                    </option>
                    <option value="guide">
                      {say(locale, "带我做", "Guide me")}
                    </option>
                    <option value="try">
                      {say(locale, "让我试", "Let me try")}
                    </option>
                  </select>
                </label>
              </>
            )}
          </DraftForm>
          {error ? (
            <div role="alert" className="space-y-2">
              <p className="text-sm text-error">{error}</p>
              {pending.current ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (pending.current) void send(pending.current);
                    }}
                  >
                    {say(locale, "重试保存", "Retry save")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      pending.current = null;
                      setError("");
                      void load(task?.id);
                    }}
                  >
                    {say(
                      locale,
                      "重新核对，保留草稿",
                      "Review again, keeping draft",
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
export default function WorkspacePageClient() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8">
          …
        </p>
      }
    >
      <WorkspaceController />
    </Suspense>
  );
}
