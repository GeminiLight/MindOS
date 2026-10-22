import { expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { generatePage, type PageGenerationModel } from "./page-generation.js";
import {
  PAGE_WORKER_INTERACTION_EXAMPLE,
  PAGE_WORKER_TASK_DATA_EXAMPLE,
} from "./page-generation.js";

it("recomputes pending tasks from live status, escapes field HTML and preserves local state", () => {
  const render = vi.fn();
  const state = { count: 2 };
  const data = {
    records: [
      { fields: { title: "评审 <原型> & \"伙伴\" '林悦' 🌿", status: "todo" } },
      { fields: { title: "推进", status: "doing" } },
      { fields: { title: "已完成", status: "done" } },
    ],
  };
  runInNewContext(PAGE_WORKER_TASK_DATA_EXAMPLE, { data, state, render });
  expect(render.mock.lastCall?.[0]).toBe(
    "<p>未完成：2</p><h2>评审 &lt;原型&gt; &amp; &quot;伙伴&quot; &#39;林悦&#39; 🌿</h2>",
  );
  expect(render.mock.lastCall?.[1]).toBe(state);
  data.records.forEach((record) => {
    record.fields.status = "done";
  });
  runInNewContext(PAGE_WORKER_TASK_DATA_EXAMPLE, { data, state, render });
  expect(render.mock.lastCall?.[0]).toContain("未完成：0");
  expect(render.mock.lastCall?.[1]).toBe(state);
});

it("renders empty task collections without inventing records or resetting state", () => {
  const render = vi.fn();
  const state = { count: 2 };
  runInNewContext(PAGE_WORKER_TASK_DATA_EXAMPLE, {
    data: { records: [] },
    state,
    render,
  });
  expect(render.mock.lastCall).toEqual(["<p>未完成：0</p><h2></h2>", state]);
});

it("renders the next interaction state immediately and keeps it on unrelated events", () => {
  const render = vi.fn();
  runInNewContext(PAGE_WORKER_INTERACTION_EXAMPLE, {
    state: {},
    event: null,
    render,
  });
  expect(render.mock.lastCall).toEqual([
    '<p>0</p><button id="increment">+1</button>',
    { count: 0 },
  ]);
  runInNewContext(PAGE_WORKER_INTERACTION_EXAMPLE, {
    state: { count: 2 },
    event: { id: "increment" },
    render,
  });
  expect(render.mock.lastCall).toEqual([
    '<p>3</p><button id="increment">+1</button>',
    { count: 3 },
  ]);
  runInNewContext(PAGE_WORKER_INTERACTION_EXAMPLE, {
    state: { count: 2 },
    event: { id: "other" },
    render,
  });
  expect(render.mock.lastCall).toEqual([
    '<p>2</p><button id="increment">+1</button>',
    { count: 2 },
  ]);
});
const spec = {
  specVersion: 1,
  title: "My work",
  layout: { columns: 1, density: "comfortable" },
  blocks: [
    { id: "intro", title: "Introduction", kind: "html", html: "<p>Hello</p>" },
    {
      id: "fixed",
      title: "Keep me",
      kind: "html",
      html: "<p>Fixed</p>",
      locked: true,
    },
  ],
};
function model(output: unknown): PageGenerationModel {
  return vi.fn(async () => ({
    text: JSON.stringify(output),
    model: "test-model",
  }));
}
it("returns a validated unsaved page with a concise summary", async () => {
  const complete = model({
    spec: { ...spec, title: "Today" },
    summary: "Updated title",
  });
  const result = await generatePage(
    { prompt: "Make today clearer", spec },
    [],
    complete,
  );
  expect(result.spec.title).toBe("Today");
  expect(result.summary).toBe("Updated title");
  expect(result.spec.blocks[1]).toEqual(spec.blocks[1]);
});
it("only applies the selected block and preserves locked blocks and page metadata", async () => {
  const changed = {
    ...spec,
    title: "Unexpected title",
    blocks: spec.blocks.map((b) => ({ ...b, title: "Changed" })),
  };
  const result = await generatePage(
    { prompt: "Change this title", spec, selectedBlockId: "intro" },
    [],
    model({ spec: changed }),
  );
  expect(result.spec.title).toBe(spec.title);
  expect(result.spec.blocks[0].title).toBe("Changed");
  expect(result.spec.blocks[1]).toEqual(spec.blocks[1]);
  await expect(
    generatePage(
      { prompt: "Change", spec, selectedBlockId: "fixed" },
      [],
      model({ spec: changed }),
    ),
  ).rejects.toMatchObject({ code: "BLOCK_LOCKED" });
});
it("rejects invented sources and leaves the original specification intact after malformed output", async () => {
  const original = JSON.stringify(spec);
  const complete = model({
    spec: {
      ...spec,
      blocks: [
        {
          id: "tasks",
          title: "Tasks",
          kind: "tasks",
          collectionId: "c-doesnotexist",
        },
      ],
    },
  });
  await expect(
    generatePage({ prompt: "Show tasks", spec }, [], complete),
  ).rejects.toMatchObject({ code: "AI_INVALID_PAGE" });
  expect(complete).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(spec)).toBe(original);
});
it("repairs a malformed answer once and supports fenced JSON without changing stable IDs", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce({ text: "not json", model: "test" })
    .mockResolvedValueOnce({
      text: "```json\n" + JSON.stringify({ spec }) + "\n```",
      model: "test",
    });
  expect(
    (await generatePage({ prompt: "Keep it", spec }, [], complete)).spec,
  ).toEqual(spec);
  expect(complete).toHaveBeenCalledTimes(2);
});
it("does not call a model for empty, oversized or missing selection requests", async () => {
  const complete = model({ spec });
  for (const input of [
    { prompt: " ", spec },
    { prompt: "x".repeat(4001), spec },
    { prompt: "Update", spec, selectedBlockId: "missing" },
  ])
    await expect(generatePage(input, [], complete)).rejects.toThrow();
  expect(complete).not.toHaveBeenCalled();
});
it("preserves user-locked blocks even when the model deletes them or clears their lock", async () => {
  const result = await generatePage(
    { prompt: "Simplify", spec },
    [],
    model({ spec: { ...spec, blocks: [spec.blocks[0]] } }),
  );
  expect(result.spec.blocks[1]).toEqual(spec.blocks[1]);
});
it("can generate the first page from a valid empty canvas", async () => {
  const empty = { ...spec, blocks: [] };
  expect(
    (
      await generatePage(
        { prompt: "Create a calm welcome page", spec: empty },
        [],
        model({ spec }),
      )
    ).spec.blocks,
  ).toHaveLength(2);
});
it("preserves existing bound sources outside the truncated discovery catalog", async () => {
  const current = {
    ...spec,
    blocks: [
      {
        id: "tasks",
        title: "Existing project",
        kind: "tasks",
        collectionId: "c-existing1234",
        locked: true,
      },
    ],
  };
  const result = await generatePage(
    { prompt: "Change the page title", spec: current },
    [],
    model({ spec: { ...current, title: "Next steps" } }),
  );
  expect(result.spec.blocks).toEqual(current.blocks);
});

const program = (code: string) => `<script type="mindos/page">${code}</script>`;
const withProgram = (code: string) => ({
  ...spec,
  blocks: [{ ...spec.blocks[0], html: program(code) }, spec.blocks[1]],
});

it("repairs an incompatible DOM program once with a specific compatibility diagnostic", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce({
      text: JSON.stringify({
        spec: withProgram("var html=document.querySelector?'':'';"),
      }),
    })
    .mockResolvedValueOnce({
      text: JSON.stringify({
        spec: withProgram("render('<p>'+data.records.length+'</p>');"),
      }),
    });
  const result = await generatePage(
    { prompt: "Make a custom task card", spec },
    [],
    complete,
  );
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1][0].prompt).toMatch(
    /Block intro.*line 1.*Unavailable global document/,
  );
  expect(complete.mock.calls[1][0].prompt).toContain("document.querySelector");
  expect(complete.mock.calls[1][0].prompt).toContain(
    '"previousBlock":{"id":"intro"',
  );
  expect(result.spec.blocks[0].html).toContain("data.records.length");
});

it("rejects two incompatible attempts without modifying the original page", async () => {
  const before = JSON.stringify(spec);
  const complete = model({
    spec: withProgram("render(window.document.title);"),
  });
  await expect(
    generatePage({ prompt: "Make a custom task card", spec }, [], complete),
  ).rejects.toMatchObject({ code: "AI_INVALID_PAGE" });
  expect(complete).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(spec)).toBe(before);
});

it("preserves existing, locked and unselected programs without revalidating or repairing them", async () => {
  const original = {
    ...spec,
    blocks: [
      { ...spec.blocks[0], html: program("document.title;") },
      { ...spec.blocks[1], html: program("window.document.body;") },
      { id: "editable", title: "Edit me", kind: "html", html: "<p>Hello</p>" },
    ],
  };
  const whole = model({ spec: { ...original, title: "New title" } });
  const wholeResult = await generatePage(
    { prompt: "Rename the page", spec: original },
    [],
    whole,
  );
  expect(wholeResult.spec.blocks).toEqual(original.blocks);
  expect(whole).toHaveBeenCalledTimes(1);
  // Invalid suggestions for protected blocks are discarded before compatibility checks.
  const selectedModel = model({
    spec: {
      ...original,
      blocks: [
        { ...original.blocks[0], html: program("window.alert('changed');") },
        { ...original.blocks[1], html: program("fetch('/x');") },
        { ...original.blocks[2], html: program("render('Updated');") },
      ],
    },
  });
  const result = await generatePage(
    {
      prompt: "Update only this block",
      spec: original,
      selectedBlockId: "editable",
    },
    [],
    selectedModel,
  );
  expect(result.spec.blocks.slice(0, 2)).toEqual(original.blocks.slice(0, 2));
  expect(selectedModel).toHaveBeenCalledTimes(1);
});
