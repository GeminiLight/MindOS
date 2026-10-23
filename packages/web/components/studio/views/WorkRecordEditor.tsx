"use client";
import { useId, useRef, useState } from "react";
import type { WorkRecord } from "@geminilight/mindos/knowledge/views";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { workRequest, projectMutationScope, type WorkViewData } from "@/lib/views/work-api";
import {
  readViewDraft,
  writeViewDraft,
  clearViewDraft,
} from "@/lib/views/drafts";
import { Field, fieldClass, useDialogReturnFocus } from "./ViewPrimitives";
import { fieldLabel, statusLabel } from "./WorkRecordView";
import { useViewOperationScope } from "@/lib/views/hooks";
import { Loader2 } from "lucide-react";
import WorkPersonField from "./WorkPersonField";
export default function WorkRecordEditor({
  data,
  record,
  initialPersonRef,
  locale,
  close,
  saved,
}: {
  data: WorkViewData;
  record?: WorkRecord;
  initialPersonRef?: string;
  locale: string;
  close: () => void;
  saved: (operationId: string) => void;
}) {
  const zh = locale === "zh",
    people = data.collection.template === "people";
  const scope = {
    rootId: data.rootId,
    viewId: data.collection.id,
    personId:
      record?.id ?? (initialPersonRef ? "new:" + initialPersonRef : "new"),
    kind: "work-record",
  };
  const [restored] = useState(() => readViewDraft(scope));
  const keys = people
    ? ["name", "background", "focus"]
    : Object.keys(data.fields);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      keys.map((k) => [
        k,
        String(
          restored?.values[k] ??
            record?.fields[k] ??
            (k === "personRef"
              ? (initialPersonRef ?? "")
              : k === "status"
                ? "todo"
                : ""),
        ),
      ]),
    ),
  );
  const [revision] = useState(
    restored?.revision ?? record?.source.revision ?? data.revision,
  );
  const [operationId] = useState(restored?.operationId ?? crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const returnFocus = useDialogReturnFocus();
  const operationScope = useViewOperationScope(data.rootId);
  const guard = useRef(false);
  const errorId = useId();
  const [invalid, setInvalid] = useState(false);
  const update = (key: string, value: string) => {
    if (guard.current || !operationScope.isCurrent()) return;
    if (invalid && key === (people ? "name" : "title")) {
      setInvalid(false);
      setError("");
    }
    const next = { ...values, [key]: value };
    setValues(next);
    if (
      !writeViewDraft(scope, {
        revision: revision ?? "",
        schemaRevision: restored?.schemaRevision ?? data.schemaRevision,
        operationId,
        values: next,
        updatedAt: Date.now(),
      })
    )
      setError(
        zh
          ? "浏览器无法保存草稿，请保持此窗口打开。"
          : "Draft storage is unavailable; keep this editor open.",
      );
  };
  const submit = async () => {
    if (guard.current || !operationScope.isCurrent()) return;
    if (!values[people ? "name" : "title"]?.trim()) {
      setInvalid(true);
      setError(
        people
          ? zh
            ? "请填写人物姓名。"
            : "Enter a person’s name."
          : zh
            ? "请填写任务名称。"
            : "Enter a task title.",
      );
      return;
    }
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await workRequest("mutate", {
        ...projectMutationScope(data),
        expectedRootId: data.rootId,
        collectionId: data.collection.id,
        recordId: record?.id,
        action: record ? "record.update" : "record.create",
        operationId,
        expectedRevision: revision || undefined,
        expectedSchemaRevision: restored?.schemaRevision ?? data.schemaRevision,
        input: values,
      });
      if (!operationScope.isCurrent()) return;
      clearViewDraft(scope);
      saved(operationId);
      close();
    } catch (e) {
      if (operationScope.isCurrent()) setError(e instanceof Error ? e.message : (zh ? "保存失败，请重试。" : "Save failed. Please retry."));
    } finally {
      guard.current = false;
      if (operationScope.isMounted()) setBusy(false);
    }
  };
  const renderField = (key: string) => (
    <Field
      key={key}
      label={fieldLabel(key, locale, data.view?.spec)}
      hint={
        key === "sourcePath"
          ? zh
            ? "可选，资料库中的文件位置。"
            : "Optional path to a file in your library."
          : undefined
      }
    >
      {(id) =>
        key === "status" ? (
          <select
            id={id}
            className={fieldClass}
            value={values[key]}
            disabled={busy}
            onChange={(e) => update(key, e.target.value)}
          >
            {["todo", "doing", "done"].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s, locale)}
              </option>
            ))}
          </select>
        ) : key === "personRef" ? (
          <WorkPersonField
            id={id}
            rootId={data.rootId}
            value={values[key]}
            onChange={(value) => update(key, value)}
            zh={zh}
            disabled={busy || operationScope.changed}
          />
        ) : ["name", "title", "dueDate", "sourcePath"].includes(key) ? (
          <input
            id={id}
            name={key}
            type={key === "dueDate" ? "date" : "text"}
            className={fieldClass}
            value={values[key]}
            disabled={busy}
            required={["name", "title"].includes(key)}
            aria-invalid={invalid && key === (people ? "name" : "title") || undefined}
            aria-describedby={invalid && key === (people ? "name" : "title") ? errorId : undefined}
            maxLength={key === "title" ? 200 : key === "name" ? 80 : 8000}
            autoFocus={key === "name" || key === "title"}
            placeholder={
              key === "title"
                ? zh
                  ? "接下来要做什么？"
                  : "What needs to happen next?"
                : undefined
            }
            onChange={(e) => update(key, e.target.value)}
          />
        ) : (
          <textarea
            id={id}
            rows={3}
            className={fieldClass}
            value={values[key]}
            disabled={busy}
            maxLength={key.startsWith("x_") ? 1000 : 8000}
            onChange={(e) => update(key, e.target.value)}
          />
        )
      }
    </Field>
  );
  const optional = keys.filter((k) => k === "sourcePath" || k.startsWith("x_"));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !guard.current) close();
      }}
    >
      <DialogContent
        finalFocus={returnFocus}
        showCloseButton={!busy}
        className="max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {people
              ? record
                ? zh
                  ? "编辑人物"
                  : "Edit person"
                : zh
                  ? "新建人物"
                  : "New person"
              : record
                ? zh
                  ? "编辑任务"
                  : "Edit task"
                : zh
                  ? "新建任务"
                  : "New task"}
          </DialogTitle>
          <DialogDescription>
            {zh
              ? "保存在本地，人与 Agent 共同维护这份资料。"
              : "Stored locally, shared by you and your Agents."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          aria-busy={busy}
          className="space-y-5"
        >
          <fieldset disabled={busy || operationScope.changed} className="space-y-5">
            {people ? (
              keys.map(renderField)
            ) : (
              <>
                {renderField("title")}
                <div className="grid gap-4 sm:grid-cols-2">
                  {renderField("status")}
                  {renderField("dueDate")}
                </div>
                {keys.includes("personRef") && renderField("personRef")}
                {!!optional.length && (
                  <details className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {zh ? "备注与来源" : "Notes and source"}
                      {optional.some((k) => values[k]) && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {zh ? "已填写" : "Has details"}
                        </span>
                      )}
                    </summary>
                    <div className="mt-4 space-y-4">
                      {optional.map(renderField)}
                    </div>
                  </details>
                )}
              </>
            )}
          </fieldset>
          {restored && (
            <p className="text-xs text-muted-foreground">
              {zh ? "已恢复未完成草稿。" : "Unsaved draft restored."}
            </p>
          )}
          {error && (
            <p
              id={errorId}
              role="alert"
              className="break-words rounded-lg bg-error/5 p-3 text-sm text-error"
            >
              {error}
            </p>
          )}
          {operationScope.changed && <p role="alert" className="text-sm text-error">{zh ? "资料库已切换，请重新打开编辑。" : "Library changed. Reopen this editor."}</p>}
          <p role="status" className="min-h-5 text-xs text-muted-foreground">{busy ? (zh ? "正在保存，请稍候…" : "Saving, please wait…") : zh ? "关闭后可继续编辑草稿。" : "You can close and resume this draft."}</p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              {zh ? "保留草稿并关闭" : "Keep draft and close"}
            </Button>
            <Button type="submit" variant="amber" disabled={busy || operationScope.changed}>
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {busy ? (zh ? "保存中…" : "Saving…") : zh ? "保存" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
