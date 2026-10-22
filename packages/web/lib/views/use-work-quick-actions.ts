"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { WorkRecord } from "@geminilight/mindos/knowledge/views";
import { workRequest, type WorkViewData } from "./work-api";
/** Keep fast actions on the same revision/idempotency boundary as full editing. */
export function useWorkQuickActions(
  data: WorkViewData | undefined,
  refresh: () => void,
  saved: (
    operationId: string | undefined,
    status: "done" | "todo" | "undo",
  ) => void,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = useRef({ data, refresh, saved }),
    active = useRef<symbol | undefined>(undefined),
    inflight = useRef(false);
  const pending = useRef<
    { fingerprint: string; operationId: string } | undefined
  >(undefined);
  const scope = data
    ? `${data.rootId}:${data.collection.id}:${data.view?.id ?? data.draftId}`
    : "";
  useLayoutEffect(() => {
    current.current = { data, refresh, saved };
  }, [data, refresh, saved]);
  useLayoutEffect(() => {
    active.current = Symbol(scope);
    inflight.current = false;
    pending.current = undefined;
    setBusy(false);
    setError("");
    return () => {
      active.current = undefined;
    };
  }, [scope]);
  async function run(
    input: Record<string, unknown>,
    status: "done" | "todo" | "undo",
  ) {
    const snapshot = current.current.data,
      token = active.current;
    if (!snapshot || !token || inflight.current || !snapshot.view) return;
    const request = {
      expectedRootId: snapshot.rootId,
      collectionId: snapshot.collection.id,
      ...input,
    };
    const fingerprint = JSON.stringify(request);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, operationId: crypto.randomUUID() };
    const operationId = pending.current.operationId;
    inflight.current = true;
    setBusy(true);
    setError("");
    try {
      await workRequest("mutate", { ...request, operationId });
      if (active.current !== token) return;
      pending.current = undefined;
      current.current.saved(
        status === "undo" ? undefined : operationId,
        status,
      );
      current.current.refresh();
    } catch (e) {
      if (active.current === token) {
        setError((e as Error).message);
        current.current.refresh();
      }
    } finally {
      if (active.current === token) {
        inflight.current = false;
        setBusy(false);
      }
    }
  }
  async function changeStatus(record: WorkRecord, status: "done" | "todo") {
    const snapshot = current.current.data,
      spec = snapshot?.view?.spec;
    if (
      !snapshot ||
      snapshot.collection.template !== "tasks" ||
      !spec?.actions.includes("record.update") ||
      !spec.fields.includes("status")
    )
      return;
    if (
      !snapshot.records.some(
        (r) =>
          r.id === record.id && r.source.revision === record.source.revision,
      ) ||
      record.rootId !== snapshot.rootId
    )
      return;
    if (record.fields.status === status) return;
    await run(
      {
        action: "record.update",
        recordId: record.id,
        expectedRevision: record.source.revision,
        expectedSchemaRevision: snapshot.schemaRevision,
        input: { status },
      },
      status,
    );
  }
  async function undo(operationId: string) {
    if (!current.current.data?.view?.spec?.actions.includes("record.update"))
      return;
    await run({ action: "operation.undo", input: { operationId } }, "undo");
  }
  return { busy, error, changeStatus, undo, clearError: () => setError("") };
}
