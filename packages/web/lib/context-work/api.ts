import { contextRequest, ViewsApiError } from "@/lib/views/api";
import { notifyFilesChanged } from "@/lib/files-changed";
export type ContextFile = { path: string; name: string; size: number };
export type ContextDocument = {
  rootId: string;
  path: string;
  content: string;
  revision: string;
};
export type ContextProgress = {
  id: string;
  title: string;
  text: string;
  path: string;
  source: string;
  createdAt: string;
};
export type ContextCollection = {
  rootId: string;
  folder: string;
  files: ContextFile[];
  progress: ContextProgress[];
  limited: boolean;
  skipped: number;
};
export type PreparedContext = { rootId: string; text: string };
export const readContext = (
  rootId: string,
  folder: string,
  signal?: AbortSignal,
) =>
  contextRequest<ContextCollection>(
    "/api/context-work?" + new URLSearchParams({ rootId, folder }),
    {},
    signal,
  );
export const readContextFile = (
  rootId: string,
  folder: string,
  path: string,
  signal?: AbortSignal,
) =>
  contextRequest<ContextDocument>(
    "/api/context-work?" +
      new URLSearchParams({ rootId, folder, path, op: "read" }),
    {},
    signal,
  );
export const prepareContext = (
  rootId: string,
  folder: string,
  goal: string,
  target: string,
  selected: Pick<ContextDocument, "path" | "revision">[],
  locale: string,
  signal?: AbortSignal,
) =>
  contextRequest<PreparedContext>(
    "/api/context-work",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        op: "prepare",
        expectedRootId: rootId,
        folder,
        goal,
        target,
        selected,
        locale,
      }),
    },
    signal,
  );
export async function saveContextProgress(
  rootId: string,
  folder: string,
  input: { operationId: string; text: string; source: string },
) {
  const result = await contextRequest<{
    rootId: string;
    path: string;
    progress: ContextProgress;
  }>("/api/context-work", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      op: "progress",
      expectedRootId: rootId,
      folder,
      ...input,
    }),
  });
  if (result.rootId !== rootId) throw new ViewsApiError("ROOT_CHANGED");
  notifyFilesChanged([result.path]);
  return result;
}
export function contextError(error: string | undefined, zh: boolean): string {
  const messages: Record<string, [string, string]> = {
    ROOT_CHANGED: [
      "知识库已切换。输入仍保留在原知识库，请回到原处继续。",
      "The library changed. Your input is preserved in the original library.",
    ],
    REVISION_CONFLICT: [
      "资料已被修改。请重新读取并核对，再继续。",
      "The source changed. Reload and review it before continuing.",
    ],
    ACCESS_DENIED: [
      "暂时无法访问这份资料，请检查目录和读写权限。",
      "This material is unavailable. Check its folder and permissions.",
    ],
    FILE_MISSING: [
      "这份文件已移动或删除。可以选择其他文件继续。",
      "This file was moved or removed. Choose another file.",
    ],
    FOLDER_MISSING: [
      "资料文件夹已移动或删除，请重新关联。",
      "The folder was moved or removed. Reconnect it.",
    ],
    DOCUMENT_TOO_LARGE: [
      "资料太大，请减少选材或在原文件编辑器中打开。",
      "The material is too large. Select fewer files or open the file editor.",
    ],
    DOCUMENT_UNREADABLE: [
      "暂时不能读取这份文本，原文件保持不变。",
      "This text cannot be read. The original file is unchanged.",
    ],
    REQUEST_TIMEOUT: [
      "读取超时了，输入已保留，请重试。",
      "The request timed out. Your input is preserved; please retry.",
    ],
    WRITE_FAILED: [
      "保存未完成，输入已保留，可以重试。",
      "Saving failed. Your input is preserved; you can retry.",
    ],
  };
  return (messages[error ?? ""] ?? [
    "暂时无法读取或保存，请重试。你的输入仍然保留。",
    "Could not read or save. Please retry; your input is preserved.",
  ])[zh ? 0 : 1];
}
