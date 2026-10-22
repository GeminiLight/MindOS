"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/stores/locale-store";
import { encodePath } from "@/lib/utils";
import { createPageDocument, pagePublicData } from "@/lib/views/page-sandbox";
import { workRequest, type WorkViewData } from "@/lib/views/work-api";
import { useViewOperationScope } from "@/lib/views/hooks";

export default function CustomPageFrame({
  html,
  data,
  title,
  rootId,
  onChanged,
  readOnly = false,
}: {
  html: string;
  data?: unknown;
  title: string;
  rootId: string;
  onChanged?: () => void;
  readOnly?: boolean;
}) {
  const { locale } = useLocale(),
    zh = locale === "zh",
    snapshot = data as WorkViewData | undefined;
  const frame = useRef<HTMLIFrameElement>(null),
    session = useRef(""),
    submitting = useRef(false),
    readOnlyRef = useRef(readOnly),
    snapshotRef = useRef(snapshot),
    contentRef = useRef(""),
    sentContent = useRef(""),
    scope = useViewOperationScope(rootId);
  const [themeRevision, setThemeRevision] = useState(0),
    [document, setDocument] = useState(""),
    [height, setHeight] = useState(240),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<{
    recordId: string;
    action: string;
    name: string;
    path?: string;
    collectionId: string;
    viewId?: string;
  }>();
  readOnlyRef.current = readOnly;
  const content = JSON.stringify(pagePublicData(data));
  snapshotRef.current = snapshot;
  contentRef.current = content;
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setThemeRevision((value) => value + 1),
    );
    observer.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const nonce = crypto.randomUUID();
    session.current = nonce;
    sentContent.current = contentRef.current;
    setReady(false);
    setError("");
    setRequest(undefined);
    const styles = getComputedStyle(window.document.documentElement),
      theme: Record<string, string> = {};
    for (const key of [
      "--background",
      "--foreground",
      "--muted",
      "--muted-foreground",
      "--border",
      "--ring",
      "--amber",
      "--amber-foreground",
      "--success",
      "--error",
    ])
      theme[key] = styles.getPropertyValue(key).trim();
    setDocument(
      createPageDocument(
        html,
        JSON.parse(contentRef.current),
        nonce,
        window.location.origin,
        theme,
      ),
    );
    const timeout = setTimeout(() => {
      if (session.current === nonce)
        setError(
          zh
            ? "自定义页面未能加载，可以重试。"
            : "The custom page could not load. Retry it.",
        );
    }, 6000);
    function receive(event: MessageEvent) {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.channel !== "mindos-page" ||
        event.data.nonce !== nonce
      )
        return;
      const message = event.data;
      if (message.type === "ready") {
        clearTimeout(timeout);
        setReady(true);
        setError("");
      }
      if (message.type === "height" && Number.isFinite(message.height))
        setHeight(Math.min(1200, Math.max(180, message.height)));
    }
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      if (session.current === nonce) session.current = "";
    };
  }, [html, attempt, rootId, zh, readOnly, themeRevision]);
  useEffect(() => {
    if (!ready || !session.current || sentContent.current === content) return;
    // An opaque-origin frame requires '*'; the receiver validates host/source/token.
    frame.current?.contentWindow?.postMessage(
      { channel: "mindos-page", nonce: session.current, type: "data", data: JSON.parse(content) },
      "*",
    );
    sentContent.current = content;
  }, [content, ready]);
  useEffect(() => {
    if (!request) return;
    const spec = snapshot?.spec ?? snapshot?.view?.spec;
    const record = snapshot?.records.find((item) => item.id === request.recordId);
    if (
      !record || !spec ||
      snapshot?.collection.id !== request.collectionId ||
      snapshot?.view?.id !== request.viewId ||
      (request.action === "task.complete" &&
        (snapshot?.collection.template !== "tasks" || !spec.actions.includes("record.update") || !spec.fields.includes("status"))) ||
      (request.action === "source.open" &&
        (!spec.actions.includes("source.open") || record.source?.path !== request.path))
    ) setRequest(undefined);
  }, [snapshot, request]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      const m = event.data;
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        m?.channel !== "mindos-page" ||
        m.nonce !== session.current ||
        m.type !== "action" ||
        busy ||
        readOnly ||
        !scope.isCurrent()
      )
        return;
      const record = snapshot?.records.find((r) => r.id === m.recordId),
        spec = snapshot?.spec ?? snapshot?.view?.spec;
      if (!record || !spec) return;
      const name = record.fields.title ?? record.fields.name ?? title;
      const binding = { collectionId: snapshot!.collection.id, viewId: snapshot?.view?.id };
      if (
        m.action === "task.complete" &&
        snapshot?.collection.template === "tasks" &&
        spec.actions.includes("record.update") &&
        spec.fields.includes("status")
      )
        setRequest({ recordId: record.id, action: m.action, name, ...binding });
      if (
        m.action === "source.open" &&
        spec.actions.includes("source.open") &&
        record.source?.path
      )
        setRequest({
          recordId: record.id,
          action: m.action,
          name,
          path: record.source.path,
          ...binding,
        });
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [snapshot, busy, title, scope, readOnly]);
  async function complete() {
    if (
      !request ||
      !snapshot ||
      request.collectionId !== snapshot.collection.id ||
      request.viewId !== snapshot.view?.id ||
      busy ||
      submitting.current ||
      readOnlyRef.current ||
      !scope.isCurrent()
    )
      return;
    submitting.current = true;
    const token = session.current,
      recordId = request.recordId;
    setBusy(true);
    setError("");
    try {
      const fresh = await workRequest<WorkViewData>("read", {
        rootId,
        ...(snapshot.view?.id
          ? { viewId: snapshot.view.id }
          : { collectionId: snapshot.collection.id }),
      });
      if (
        !scope.isCurrent() ||
        session.current !== token ||
        readOnlyRef.current
      )
        return;
      const spec = fresh.view?.spec ?? snapshot.spec,
        record = fresh.records.find((r) => r.id === recordId),
        current = snapshotRef.current,
        currentSpec = current?.spec ?? current?.view?.spec;
      if (
        current?.collection.id !== snapshot.collection.id ||
        current?.view?.id !== snapshot.view?.id ||
        !current.records.some((item) => item.id === recordId) ||
        !currentSpec?.actions.includes("record.update") ||
        !currentSpec.fields.includes("status") ||
        fresh.rootId !== rootId ||
        fresh.collection.id !== snapshot.collection.id ||
        fresh.collection.template !== "tasks" ||
        !record ||
        !spec?.actions.includes("record.update") ||
        !spec.fields.includes("status")
      )
        throw new Error(
          zh
            ? "资料或权限已变化，请刷新页面。"
            : "The data or actions changed. Refresh this page.",
        );
      if (record.fields.status === "done") {
        setRequest(undefined);
        onChanged?.();
        return;
      }
      await workRequest("mutate", {
        expectedRootId: rootId,
        collectionId: fresh.collection.id,
        recordId,
        action: "record.update",
        expectedRevision: fresh.revision,
        expectedSchemaRevision: fresh.schemaRevision,
        operationId: crypto.randomUUID(),
        input: { status: "done" },
      });
      if (scope.isCurrent()) {
        setRequest(undefined);
        onChanged?.();
      }
    } catch (e) {
      if (scope.isCurrent()) setError((e as Error).message);
    } finally {
      submitting.current = false;
      if (scope.isMounted()) setBusy(false);
    }
  }
  return (
    <div className="min-w-0">
      {!ready && !error && (
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          {zh ? "正在打开自定义页面…" : "Opening custom page…"}
        </p>
      )}
      {document && (
        <iframe
          ref={frame}
          title={title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={document}
          className="w-full rounded-lg border-0"
          style={{ height }}
        />
      )}
      {request && !readOnly && !scope.changed && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
          role="status"
        >
          <p className="min-w-0 flex-1 break-words text-sm">
            {request.action === "task.complete"
              ? zh
                ? `将「${request.name}」标记为完成？`
                : `Mark “${request.name}” complete?`
              : zh
                ? `打开「${request.name}」的原文件`
                : `Open the source for “${request.name}”`}
          </p>
          {request.action === "task.complete" ? (
            <Button size="sm" disabled={busy} onClick={() => void complete()}>
              {busy
                ? zh
                  ? "保存中…"
                  : "Saving…"
                : zh
                  ? "确认完成"
                  : "Complete task"}
            </Button>
          ) : (
            <Link
              className="text-sm underline focus-visible:ring-2 focus-visible:ring-ring"
              href={"/view/" + encodePath(request.path!)}
            >
              {zh ? "打开原文件" : "Open source"}
            </Link>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setRequest(undefined)}
          >
            {zh ? "取消" : "Cancel"}
          </Button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mt-2 flex flex-wrap items-center gap-2 text-sm text-error"
        >
          <span>{error}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setAttempt((n) => n + 1)}
          >
            {zh ? "重新加载" : "Reload"}
          </Button>
        </div>
      )}
    </div>
  );
}
