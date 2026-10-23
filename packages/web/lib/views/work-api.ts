import type {
  WorkSnapshot,
  ViewDefinition,
  ViewSpec,
} from "@geminilight/mindos/knowledge/views";
import { notifyFilesChanged } from "@/lib/files-changed";
export type WorkViewData = WorkSnapshot & {
  view?: ViewDefinition & { spec: ViewSpec };
  draftId?: string;
  spec?: ViewSpec;
};
export function projectMutationScope(data: Pick<WorkSnapshot, "projectScope">) {
  return data.projectScope
    ? {
        projectId: data.projectScope.id,
        expectedProjectVersion: data.projectScope.version,
      }
    : {};
}
export async function workRequest<T = Record<string, unknown>>(
  op: string,
  input: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const write =
      ["create", "mutate", "save"].includes(op) ||
      (op === "preview" && !input.draftId),
    url = new URL("/api/views/v2", window.location.origin);
  if (!write) {
    url.searchParams.set("op", op);
    for (const [k, v] of Object.entries(input))
      if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const response = await fetch(url, {
    method: write ? "POST" : "GET",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-MindOS-Source": "user" },
    ...(write ? { body: JSON.stringify({ ...input, op }) } : {}),
    signal: signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(
            process.env.NODE_ENV === "development" ? 90000 : 15000,
          ),
        ])
      : AbortSignal.timeout(
          process.env.NODE_ENV === "development" ? 90000 : 15000,
        ),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.message ?? body.error ?? "Request failed");
  if (write && op !== "preview") {
    notifyFilesChanged(body.changedPaths);
    window.dispatchEvent(new Event("mindos:views-updated"));
  }
  return body;
}
