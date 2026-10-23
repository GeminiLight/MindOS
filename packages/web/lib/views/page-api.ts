import type {
  PageSpec,
  SavedPage,
  PageBlockData,
  CollectionDefinition,
  ViewDefinition,
} from "@geminilight/mindos/knowledge/views";
import { notifyFilesChanged } from "@/lib/files-changed";
export type PageRead = {
  rootId: string;
  page: SavedPage;
  blocks: PageBlockData[];
};
export type PagePreview = {
  rootId: string;
  spec: PageSpec;
  blocks: PageBlockData[];
};
export type PageIndex = { rootId: string; pages: Omit<SavedPage, "history">[] };
export type PageSources = {
  rootId: string;
  collections: CollectionDefinition[];
  views: ViewDefinition[];
};
export class PageRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function pageRequest<T>(
  op: string,
  input: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const write = !["page.list", "page.read", "page.data", "list",'read','project.list','project.read'].includes(op),
    url = new URL("/api/views/v2", window.location.origin);
  if (!write) {
    url.searchParams.set("op", op);
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: write ? "POST" : "GET",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-MindOS-Source": "user" },
    ...(write ? { body: JSON.stringify({ ...input, op }) } : {}),
    signal: signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(op === "page.generate" ? 100000 : 20000),
        ])
      : AbortSignal.timeout(op === "page.generate" ? 100000 : 20000),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new PageRequestError(
      "The server returned an unreadable response. Please retry.",
      "INVALID_RESPONSE",
      response.status,
    );
  }
  if (!response.ok)
    throw new PageRequestError(
      body.message ?? body.error ?? "Request failed",
      body.code ?? body.error ?? "REQUEST_FAILED",
      response.status,
    );
  if (["page.save", "page.restore", "page.remove",'project.save','project.interact','project.page'].includes(op)) {
    notifyFilesChanged(body.changedPaths);
    window.dispatchEvent(new Event("mindos:views-updated"));
  }
  return body as T;
}
