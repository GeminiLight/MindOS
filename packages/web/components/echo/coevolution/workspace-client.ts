import type {
  CoevolutionTask,
  CoevolutionMethod,
  CoevolutionRun,
  Inquiry,
  LearningLoop,
} from "@geminilight/mindos/knowledge";
export type WorkspaceView = {
  task?: CoevolutionTask;
  tasks?: CoevolutionTask[];
  methods?: CoevolutionMethod[];
  runs?: CoevolutionRun[];
  inquiry?: Inquiry | null;
  learningLoops?: LearningLoop[];
  unavailableCount?: number;
  draft?: { prompt: string; preparationId: string; intent?: string; chatSessionId?: string };
  decisionDelivery?: {
    status: "delivered" | "already-delivered" | "not-waiting" | "unavailable";
    message?: string;
  };
};
export class WorkspaceError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export async function workspaceRequest<T = WorkspaceView>(
  path: string,
  body?: Record<string, unknown>,
  method = body ? "PATCH" : "GET",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new WorkspaceError(
      typeof data.code === "string"
        ? data.code
        : response.status === 401
          ? "auth"
          : "storage",
    );
  if (!data || typeof data !== "object") throw new WorkspaceError("storage");
  return data as T;
}
export function workspaceError(
  error: unknown,
  locale: string,
  operation: "load" | "save" = "save",
) {
  const code = error instanceof WorkspaceError ? error.code : "storage";
  const zh = locale === "zh";
  return code === "conflict"
    ? zh
      ? "记录已变化。草稿仍保留，请重新载入后核对再提交。"
      : "This record changed. Your draft is retained; reload and review it before submitting."
    : code === "not-found"
      ? zh
        ? "这份任务或来源已不可用。可以返回任务列表。"
        : "This task or source is unavailable. Return to the task list."
      : code === "invalid"
        ? zh
          ? "请检查必填内容和证据引用，修改后再提交。"
          : "Check the required fields and evidence quotation, then submit again."
        : ["auth", "unauthorized", "forbidden"].includes(code)
          ? zh
            ? "请先解锁 MindOS，再重试。"
            : "Unlock MindOS, then retry."
          : operation === "load"
            ? zh
              ? "暂时没有读到任务，请重试。已有记录和草稿仍保留。"
              : "Could not load this task. Retry; your records and drafts are retained."
            : zh
              ? "暂时无法确认保存结果，草稿已保留。请重试；不会重复创建。"
              : "Could not confirm the save. Your draft is retained. Retry safely without creating duplicates.";
}
