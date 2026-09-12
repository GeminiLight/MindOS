"use client";
import { useEffect, useRef, useState, type SetStateAction } from "react";
import { useLocale } from "@/lib/stores/locale-store";
const prefix = "mindos-echo-draft-v1:";
const ttl = 7 * 86400000;
const event = "echo-draft-storage";
export function readEchoDraft<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(prefix + key);
    if (!raw || raw.length > 200000) return initial;
    const record = JSON.parse(raw);
    if (
      record.schema !== 1 ||
      typeof record.at !== "number" ||
      Date.now() - record.at > ttl ||
      Date.now() < record.at
    ) {
      localStorage.removeItem(prefix + key);
      return initial;
    }
    if (
      typeof record.value !== typeof initial ||
      Array.isArray(initial) !== Array.isArray(record.value)
    )
      return initial;
    return record.value as T;
  } catch {
    return initial;
  }
}
/** Unsent owner forms only. Record-specific IDs prevent cross-record restoration. No invitations or credentials. */
export function useEchoDraft<T>(key: string, initial: T | (() => T)) {
  const first = () =>
    typeof initial === "function" ? (initial as () => T)() : initial;
  const base = useRef({ key, value: first() });
  if (base.current.key !== key) base.current = { key, value: first() };
  const [state, setState] = useState(() => ({
    key,
    value: base.current.value,
  }));
  const [failed, setFailed] = useState(false),
    [restored, setRestored] = useState(false);
  const current = useRef(state);
  current.current = state;
  if (state.key !== key) {
    const value = readEchoDraft(key, base.current.value);
    setState({ key, value });
    current.current = { key, value };
  }
  useEffect(() => {
    const value = readEchoDraft(key, base.current.value);
    current.current = { key, value };
    setState({ key, value });
    setRestored(JSON.stringify(value) !== JSON.stringify(base.current.value));
  }, [key]);
  function setValue(action: SetStateAction<T>) {
    const previous =
      current.current.key === key
        ? current.current.value
        : readEchoDraft(key, base.current.value);
    const value =
      typeof action === "function" ? (action as (v: T) => T)(previous) : action;
    current.current = { key, value };
    setState({ key, value });
    try {
      const raw = JSON.stringify({ schema: 1, at: Date.now(), value });
      if (raw.length > 200000) throw Error("Draft too large");
      if (JSON.stringify(value) === JSON.stringify(base.current.value))
        localStorage.removeItem(prefix + key);
      else localStorage.setItem(prefix + key, raw);
      setFailed(false);
      window.dispatchEvent(
        new CustomEvent(event, { detail: { failed: false } }),
      );
    } catch {
      setFailed(true);
      window.dispatchEvent(
        new CustomEvent(event, { detail: { failed: true } }),
      );
    }
  }
  return [
    state.key === key ? state.value : current.current.value,
    setValue,
    { failed, restored },
  ] as const;
}
export function EchoDraftNotice({ locale: language, state }: { locale?: "en" | "zh"; state?: { failed: boolean; restored: boolean } } = {}) {
  const { locale } = useLocale();
  const [storageFailed, setFailed] = useState(false);
  const failed = state?.failed ?? storageFailed;
  const zh = (language ?? locale) === "zh";
  useEffect(() => {
    const on = (e: Event) => setFailed(!!(e as CustomEvent).detail?.failed);
    window.addEventListener(event, on);
    return () => window.removeEventListener(event, on);
  }, []);
  return (
    <p
      role={failed ? "alert" : "status"}
      className="text-xs leading-5 text-muted-foreground"
    >
      {failed
        ? zh
          ? "草稿暂时无法保存到本机，请保留此页面或复制内容。"
          : "Draft storage is unavailable. Keep this page open or copy your work."
        : state?.restored
          ? zh ? "已恢复本机草稿。尚未提交，请核对后继续。" : "Draft restored from this device. Review it before submitting."
        : zh
          ? "未提交的草稿在本机保留 7 天，返回或重新打开后可继续。"
          : "Unsubmitted drafts stay on this device for 7 days, ready when you return."}
    </p>
  );
}

export function clearEchoDrafts(scope: string) {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix + scope)) localStorage.removeItem(key);
  } catch {
    /* Storage failures are reported on the next edit. */
  }
}
