"use client";
import { useEffect, useState } from "react";
import type { WorkSnapshot } from "@geminilight/mindos/knowledge/views";
import { workRequest } from "@/lib/views/work-api";
import { fieldClass } from "./ViewPrimitives";
import { Button } from "@/components/ui/button";

type Collection = { id: string; folder: string; template: string };
/** Load only the selected people collection; never replace an unavailable reference. */
export default function WorkPersonField({
  id,
  rootId,
  value,
  onChange,
  zh,
  disabled = false,
}: {
  id: string;
  rootId: string;
  value: string;
  onChange: (value: string) => void;
  zh: boolean;
  disabled?: boolean;
}) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState(value.split("/")[0] || "");
  const [people, setPeople] = useState<WorkSnapshot["records"]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPeople([]);
    void (async () => {
      try {
        const list = await workRequest<{
          rootId: string;
          collections: Collection[];
        }>("list", {}, controller.signal);
        if (list.rootId !== rootId)
          throw new Error(
            zh
              ? "资料库已切换，请重新打开编辑。"
              : "Library changed. Reopen this editor.",
          );
        const available = list.collections.filter(
          (c) => c.template === "people",
        );
        if (!controller.signal.aborted) setCollections(available);
        if (collectionId && available.some((c) => c.id === collectionId)) {
          const data = await workRequest<WorkSnapshot>(
            "read",
            { collectionId },
            controller.signal,
          );
          if (data.rootId !== rootId)
            throw new Error(
              zh
                ? "资料库已切换，请重新打开编辑。"
                : "Library changed. Reopen this editor.",
            );
          if (!controller.signal.aborted) {
            setPeople(data.records);
            if (data.limited || data.skipped)
              setError(
                zh
                  ? "部分人物未能载入，可重试或保留当前关联。"
                  : "Some people could not be loaded. Retry or keep the current link.",
              );
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [collectionId, rootId, retry, zh]);
  const known = people.some((p) => `${collectionId}/${p.id}` === value);
  return (
    <div className="space-y-2">
      <select
        id={id}
        className={fieldClass}
        value={collectionId}
        disabled={loading || disabled}
        onChange={(e) => setCollectionId(e.target.value)}
        aria-label={zh ? "人物资料夹" : "People folder"}
      >
        <option value="">
          {loading
            ? zh
              ? "正在读取人物…"
              : "Loading people…"
            : zh
              ? "选择人物资料夹"
              : "Choose a people folder"}
        </option>
        {collectionId && !collections.some((c) => c.id === collectionId) && (
          <option value={collectionId}>
            {zh ? "当前关联资料夹不可用" : "Current folder unavailable"}
          </option>
        )}
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.folder}
          </option>
        ))}
      </select>
      {(collectionId || value) && (
        <select
          aria-label={zh ? "选择人物" : "Choose a person"}
          className={fieldClass}
          value={value}
          disabled={loading || disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{zh ? "不关联人物" : "No linked person"}</option>
          {value && !known && (
            <option value={value}>
              {zh ? "保留当前关联" : "Keep current link"}
            </option>
          )}
          {people.map((p) => (
            <option key={p.id} value={`${collectionId}/${p.id}`}>
              {p.fields.name}
            </option>
          ))}
        </select>
      )}
      {!loading && !collections.length && !error && (
        <p className="text-xs text-muted-foreground">
          {zh
            ? "先在视图中添加人脉资料，之后就可以在这里选择。"
            : "Add a people collection in Views to link a person here."}
        </p>
      )}
      {error && (
        <div role="status" className="text-xs text-muted-foreground">
          {error}{" "}
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || loading}
            onClick={() => setRetry((n) => n + 1)}
          >
            {zh ? "重试" : "Retry"}
          </Button>
        </div>
      )}
    </div>
  );
}
