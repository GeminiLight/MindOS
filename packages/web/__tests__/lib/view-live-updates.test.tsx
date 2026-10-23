// @vitest-environment jsdom
import React, { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useViewLiveUpdates, useViewResource } from "@/lib/views/hooks";
vi.mock("@/lib/server-events", () => ({
  subscribeServerEvents: () => () => {},
}));
vi.mock("@/lib/files-changed", () => ({
  subscribeFilesChanged: () => () => {},
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function Live({
  read,
  active = true,
}: {
  read: () => Promise<string>;
  active?: boolean;
}) {
  const load = useCallback(() => read(), [read]);
  const resource = useViewResource(load, active);
  useViewLiveUpdates(resource.refresh, resource.loading, active, 1000);
  return <p>{resource.data}</p>;
}
it("keeps visible data fresh through repeated reads when a live connection silently delivers no events", async () => {
  let record = "原始背景";
  const read = vi.fn(async () => record);
  await act(async () => root.render(<Live read={read} />));
  expect(host.textContent).toBe("原始背景");
  record = "外部更新的背景";
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(host.textContent).toBe(record);
  record = "下一次更新";
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(host.textContent).toBe(record);
  expect(read).toHaveBeenCalledTimes(3);
});
it("does not overlap a pending request and stops reading while hidden or inactive", async () => {
  let finish!: (value: string) => void;
  const read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(<Live read={read} />));
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => finish("完成"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Live read={read} active={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(read).toHaveBeenCalledTimes(1);
});
it("retains the last successful data after a read fails and recovers on the next bounded retry", async () => {
  const read = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce("已有内容")
    .mockRejectedValueOnce(Error("断线"))
    .mockResolvedValue("恢复连接");
  await act(async () => root.render(<Live read={read} />));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(host.textContent).toBe("已有内容");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(host.textContent).toBe("恢复连接");
});
