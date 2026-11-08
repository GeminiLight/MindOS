"use client";
import { useEffect, useState } from "react";
import {
  CONTEXT_POSITION_CHANGED,
  readContextPositions,
  type ContextPosition,
} from "./continuity";
export function useContextPositions(rootId: string) {
  const [entries, setEntries] = useState<{
    rootId: string;
    rows: ContextPosition[];
  }>({ rootId, rows: [] });
  useEffect(() => {
    const sync = () =>
      setEntries({ rootId, rows: readContextPositions(rootId) });
    sync();
    window.addEventListener(CONTEXT_POSITION_CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CONTEXT_POSITION_CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, [rootId]);
  return entries.rootId === rootId ? entries.rows : [];
}
