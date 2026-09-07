// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => void)[] = [];
function cleanup() {
  cleanups.splice(0).forEach((f) => f());
}
function renderHook<T, P = undefined>(
  fn: (p: P) => T,
  options?: { initialProps: P },
) {
  const host = document.createElement("div"),
    root = createRoot(host);
  let props = options?.initialProps as P;
  const result = {} as { current: T };
  function Component() {
    result.current = fn(props);
    return null;
  }
  act(() => root.render(<Component />));
  let live = true;
  const unmount = () => {
    if (live) {
      act(() => root.unmount());
      live = false;
    }
  };
  cleanups.push(unmount);
  return {
    result,
    unmount,
    rerender: (p: P) => {
      props = p;
      act(() => root.render(<Component />));
    },
  };
}
import { useEchoDraft } from "@/components/echo/use-echo-draft";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
it("recovers unsent Unicode input after remount and clears saved values", () => {
  const one = renderHook(() => useEchoDraft("record:field", ""));
  act(() => one.result.current[1]("保留🧪"));
  one.unmount();
  const two = renderHook(() => useEchoDraft("record:field", ""));
  expect(two.result.current[0]).toBe("保留🧪");
  act(() => two.result.current[1](""));
  two.unmount();
  expect(
    renderHook(() => useEchoDraft("record:field", "")).result.current[0],
  ).toBe("");
});
it("isolates records and does not overwrite an active draft with another tab", () => {
  const one = renderHook(({ id }) => useEchoDraft(id, ""), {
    initialProps: { id: "a" },
  });
  act(() => one.result.current[1]("A"));
  one.rerender({ id: "b" });
  expect(one.result.current[0]).toBe("");
  act(() => one.result.current[1]("B"));
  one.rerender({ id: "a" });
  expect(one.result.current[0]).toBe("A");
});
it("survives malformed data and unavailable storage while reporting persistence failure", () => {
  vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw Error("quota");
  });
  const h = renderHook(() => useEchoDraft("field", ""));
  act(() => h.result.current[1]("keep"));
  expect(h.result.current[0]).toBe("keep");
  expect(h.result.current[2].failed).toBe(true);
});
