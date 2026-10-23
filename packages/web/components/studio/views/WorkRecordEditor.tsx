"use client";
import { useState } from "react";
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
  const update = (key: string, value: string) => {
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
    if (busy) return;
    if (!values[people ? "name" : "title"]?.trim()) {
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
      clearViewDraft(scope);
      saved(operationId);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        finalFocus={returnFocus}
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
          className="space-y-5"
        >
          <fieldset disabled={busy} className="space-y-5">
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
              role="alert"
              className="rounded-lg bg-error/5 p-3 text-sm text-error"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              {zh ? "保留草稿并关闭" : "Keep draft and close"}
            </Button>
            <Button type="submit" variant="amber" disabled={busy}>
              {busy ? (zh ? "保存中…" : "Saving…") : zh ? "保存" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
