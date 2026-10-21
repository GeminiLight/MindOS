import type {
  ViewIndex,
  ViewCollection,
  ViewPreview,
  ViewSummary,
  PersonDocument,
  ViewMaterial,
} from "@geminilight/mindos/knowledge/views";
export type {
  ViewIndex,
  ViewCollection,
  ViewPreview,
  ViewSummary,
  PersonDocument,
  ViewMaterial,
  PersonSummary,
} from "@geminilight/mindos/knowledge/views";
export const VIEWS_UPDATED = "mindos:views-updated";
export class ViewsApiError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(code);
    this.name = "ViewsApiError";
  }
}
async function request<T>(
  url: string,
  options: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    abort,
    process.env.NODE_ENV === "production" ? 15_000 : 90_000,
  );
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
    });
    let value: Record<string, unknown>;
    try {
      value = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new ViewsApiError("INVALID_RESPONSE", response.status);
    }
    if (!response.ok)
      throw new ViewsApiError(
        typeof value.error === "string" ? value.error : "VIEWS_UNAVAILABLE",
        response.status,
      );
    if (!value || typeof value.rootId !== "string")
      throw new ViewsApiError("INVALID_RESPONSE", response.status);
    return value as T;
  } catch (error) {
    if (signal?.aborted) throw new ViewsApiError("REQUEST_CANCELLED");
    if (error instanceof ViewsApiError) throw error;
    throw new ViewsApiError(
      controller.signal.aborted ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
function query(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, value);
  return "/api/views?" + params;
}
export async function getViewsIndex(signal?: AbortSignal): Promise<ViewIndex> {
  const data = await request<ViewIndex>("/api/views", {}, signal);
  if (!Array.isArray(data.views) || !Array.isArray(data.folders))
    throw new ViewsApiError("INVALID_RESPONSE");
  return data;
}
export const getView = (rootId: string, id: string, signal?: AbortSignal) =>
  request<ViewCollection & { rootId: string }>(
    query({ op: "read", rootId, id }),
    {},
    signal,
  );
export const getViewPreview = (
  rootId: string,
  folder: string,
  signal?: AbortSignal,
) =>
  request<ViewPreview & { rootId: string }>(
    query({ op: "preview", rootId, folder }),
    {},
    signal,
  );
export const getViewPerson = (
  rootId: string,
  id: string,
  personId: string,
  path?: string,
  signal?: AbortSignal,
) =>
  request<{ rootId: string; person: PersonDocument }>(
    query({ op: "person", rootId, id, personId, path }),
    {},
    signal,
  );
export const getViewRaw = (
  rootId: string,
  id: string,
  path: string,
  signal?: AbortSignal,
) =>
  request<{ rootId: string; path: string; content: string; revision: string }>(
    query({ op: "raw", rootId, id, path }),
    {},
    signal,
  );
export const getViewMaterials = (
  rootId: string,
  id: string,
  p: PersonDocument,
  selected: string[],
  target: string,
  locale: string,
  signal?: AbortSignal,
) =>
  request<{
    rootId: string;
    revision: string;
    items: ViewMaterial[];
    text: string;
  }>(
    query({
      op: "prepare",
      rootId,
      id,
      personId: p.id,
      path: p.path,
      expectedRevision: p.revision,
      selected: selected.join(","),
      target,
      locale,
    }),
    {},
    signal,
  );
export async function mutateView<T>(
  rootId: string,
  body: Record<string, unknown>,
): Promise<T & { rootId: string }> {
  const value = await request<T & { rootId: string }>("/api/views", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MindOS-Source": "user" },
    body: JSON.stringify({ ...body, expectedRootId: rootId }),
  });
  if (value.rootId !== rootId) throw new ViewsApiError("ROOT_CHANGED", 409);
  window.dispatchEvent(new CustomEvent(VIEWS_UPDATED, { detail: { rootId } }));
  return value;
}
export const exportViewUrl = (rootId: string, id: string) =>
  query({ op: "csv", rootId, id });
export type ViewMutationResult = {
  view?: ViewSummary;
  person?: PersonDocument;
  ok?: boolean;
};
