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
import { workRequest, type WorkViewData } from "@/lib/views/work-api";
import {
  readViewDraft,
  writeViewDraft,
  clearViewDraft,
} from "@/lib/views/drafts";
import { Field, fieldClass, useDialogReturnFocus } from "./ViewPrimitives";
import { fieldLabel, statusLabel } from "./WorkRecordView";
export default function WorkRecordEditor({
  data,
  record,
  locale,
  close,
  saved,
}: {
  data: WorkViewData;
  record?: WorkRecord;
  locale: string;
  close: () => void;
  saved: (operationId: string) => void;
}) {
  const zh = locale === "zh",
    people = data.collection.template === "people";
  const scope = {
    rootId: data.rootId,
    viewId: data.collection.id,
    personId: record?.id ?? "new",
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
            (k === "status" ? "todo" : ""),
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
    setBusy(true);
    setError("");
    try {
      await workRequest("mutate", {
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
            {record
              ? zh
                ? "编辑记录"
                : "Edit record"
              : zh
                ? "新建记录"
                : "New record"}
          </DialogTitle>
          <DialogDescription>
            {zh
              ? "保存到本地原文件；其他 Agent 将读取同一份资料。"
              : "Saved to the original local file, shared with your Agents."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          {keys.map((key) => (
            <Field key={key} label={fieldLabel(key, locale, data.view?.spec)}>
              {(id) =>
                key === "status" ? (
                  <select
                    id={id}
                    className={fieldClass}
                    value={values[key]}
                    onChange={(e) => update(key, e.target.value)}
                  >
                    {["todo", "doing", "done"].map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s, locale)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    id={id}
                    rows={["background", "focus"].includes(key) ? 3 : 1}
                    className={fieldClass}
                    value={values[key]}
                    required={["name", "title"].includes(key)}
                    maxLength={
                      key === "title"
                        ? 200
                        : key === "name"
                          ? 80
                          : key.startsWith("x_")
                            ? 1000
                            : 8000
                    }
                    onChange={(e) => update(key, e.target.value)}
                  />
                )
              }
            </Field>
          ))}
          {restored && (
            <p className="text-sm text-muted-foreground">
              {zh ? "已恢复未完成草稿。" : "Unsaved draft restored."}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-error">
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
