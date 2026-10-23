"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot } from "@geminilight/mindos/knowledge/views";
import { pageRequest } from "@/lib/views/page-api";
import { Button } from "@/components/ui/button";
import { fieldClass } from "../views/ViewPrimitives";
import { encodePath } from "@/lib/utils";

function today() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
export default function ProjectCommunication({
  snapshot,
  zh,
  readOnly,
  refresh,
}: {
  snapshot: ProjectSnapshot;
  zh: boolean;
  readOnly?: boolean;
  refresh: () => void;
}) {
  const key =
    "mindos:project-communication:" +
    JSON.stringify([snapshot.rootId, snapshot.project.id]);
  const [draft, setDraft] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        d &&
        typeof d.text === "string" &&
        d.text.length <= 8000 &&
        typeof d.personRef === "string" &&
        typeof d.date === "string"
      )
        return {
          text: d.text as string,
          personRef: d.personRef as string,
          date: d.date as string,
          operationId:
            typeof d.operationId === "string" &&
            /^[a-f0-9-]{36}$/.test(d.operationId)
              ? d.operationId
              : crypto.randomUUID(),
        };
    } catch {}
    return {
      text: "",
      personRef: snapshot.people[0]?.ref ?? "",
      date: today(),
      operationId: crypto.randomUUID(),
    };
  });
  const [open, setOpen] = useState(!!draft.text),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [storage, setStorage] = useState(true);
  const guard = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      if (draft.text) localStorage.setItem(key, JSON.stringify(draft));
      else localStorage.removeItem(key);
      setStorage(true);
    } catch {
      setStorage(false);
    }
  }, [draft, key]);
  const person = snapshot.people.find((p) => p.ref === draft.personRef);
  async function save() {
    if (
      readOnly ||
      guard.current ||
      !person ||
      !draft.text.trim() ||
      !draft.date
    )
      return;
    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await pageRequest("project.interact", {
        projectId: snapshot.project.id,
        expectedRootId: snapshot.rootId,
        expectedVersion: snapshot.project.version,
        personRef: person.ref,
        expectedRevision: person.revision,
        expectedSchemaRevision: person.schemaRevision,
        operationId: draft.operationId,
        text: draft.text,
        date: draft.date,
      });
      if (!active.current) return;
      setDraft((d) => ({ ...d, text: "", operationId: crypto.randomUUID() }));
      setOpen(false);
      setNotice(
        zh
          ? "已保存到人物档案，项目与人物页共用这条记录。"
          : "Saved to the person’s original profile and this project.",
      );
      refresh();
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      guard.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section
      className="mt-6 border-t border-border pt-5"
      aria-label={zh ? "项目沟通" : "Project conversations"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {zh ? "沟通与决定" : "Conversations and decisions"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {zh
              ? "写在人物原档案里，带着项目上下文继续。"
              : "Keep the original person record connected to the project."}
          </p>
        </div>
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            disabled={busy || !snapshot.people.length}
          >
            {open
              ? zh
                ? "收起"
                : "Close"
              : zh
                ? "记录沟通"
                : "Record conversation"}
          </Button>
        )}
      </div>
      {open && !readOnly && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span>{zh ? "沟通对象" : "Person"}</span>
              <select
                aria-label={zh ? "沟通对象" : "Person"}
                className={fieldClass}
                value={person ? draft.personRef : ""}
                disabled={busy}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    personRef: e.target.value,
                    operationId: crypto.randomUUID(),
                  }))
                }
              >
                <option value="" disabled>
                  {zh ? "选择项目人物" : "Choose a linked person"}
                </option>
                {snapshot.people.map((p) => (
                  <option key={p.ref} value={p.ref}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span>{zh ? "沟通日期" : "Date"}</span>
              <input
                aria-label={zh ? "沟通日期" : "Date"}
                type="date"
                value={draft.date}
                disabled={busy}
                className={fieldClass}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    date: e.target.value,
                    operationId: crypto.randomUUID(),
                  }))
                }
              />
            </label>
          </div>
          <label className="block space-y-1 text-xs">
            <span>{zh ? "沟通内容" : "Conversation"}</span>
            <textarea
              aria-label={zh ? "沟通内容" : "Conversation"}
              rows={3}
              maxLength={8000}
              disabled={busy}
              className={fieldClass}
              value={draft.text}
              placeholder={
                zh
                  ? "讨论了什么？确认了什么？下一步由谁推进？"
                  : "What was discussed, decided, and who takes the next step?"
              }
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  text: e.target.value,
                  operationId: crypto.randomUUID(),
                }))
              }
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="amber"
              disabled={busy || !person || !draft.text.trim() || !draft.date}
            >
              {busy
                ? zh
                  ? "正在保存…"
                  : "Saving…"
                : zh
                  ? "保存沟通"
                  : "Save conversation"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {zh ? "草稿保留在当前浏览器。" : "Draft stays in this browser."}
            </span>
          </div>
        </form>
      )}
      {error && (
        <div role="alert" className="mt-3 text-sm text-error">
          {error}
          <Button size="sm" variant="ghost" onClick={refresh}>
            {zh ? "刷新资料，保留草稿" : "Refresh, keep draft"}
          </Button>
        </div>
      )}
      {!storage && (
        <p role="alert" className="mt-3 text-sm text-error">
          {zh
            ? "浏览器无法保留草稿。请先保存或复制内容，再离开页面。"
            : "This browser could not retain the draft. Save or copy it before leaving."}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-success">
          {notice}
        </p>
      )}
      {!snapshot.activity.length && !open && (
        <p className="mt-4 text-sm text-muted-foreground">
          {zh
            ? "还没有项目沟通。记录一次讨论，让下一步有来处。"
            : "No project conversations yet. Capture a discussion to ground the next step."}
        </p>
      )}
      <ol className="mt-4 divide-y divide-border">
        {snapshot.activity.map((entry) => (
          <li key={entry.personRef + "/" + entry.id} className="py-4">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {entry.personName}
              </span>
              <time>{entry.date}</time>
              <Link
                href={"/view/" + encodePath(entry.path)}
                className="underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {zh ? "人物原文" : "Original profile"}
              </Link>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-6">
              {entry.text}
            </p>
            {entry.source && (
              <p className="mt-1 text-xs text-muted-foreground">
                {entry.source}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
