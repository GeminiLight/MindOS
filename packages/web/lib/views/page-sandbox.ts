/** Untrusted HTML never executes in the DOM. Optional programs run in a disposable Worker. */
export function sanitizePageHtml(source: string): {
  html: string;
  code: string;
} {
  if (typeof source !== "string" || source.length > 131072)
    throw new Error("Page markup is too large");
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const code = Array.from(parsed.querySelectorAll('script[type="mindos/page"]'))
    .map((el) => el.textContent ?? "")
    .join("\n");
  const allowed = new Set(
    "html head body title style div span article section header footer main aside nav h1 h2 h3 h4 h5 h6 p br hr strong b em i small s del mark code pre blockquote ul ol li dl dt dd table thead tbody tfoot tr th td caption colgroup col button input label select option optgroup textarea details summary progress meter img a".split(
      " ",
    ),
  );
  for (const el of Array.from(parsed.querySelectorAll("*"))) {
    if (!allowed.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const key = attr.name.toLowerCase(),
        value = attr.value;
      const safe =
        /^(class|id|style|title|role|type|value|placeholder|disabled|checked|selected|multiple|for|name|min|max|step|rows|cols|colspan|rowspan|open|tabindex|alt|width|height)$/.test(
          key,
        ) ||
        key.startsWith("aria-") ||
        key.startsWith("data-");
      if (
        key === "src" &&
        el.tagName === "IMG" &&
        /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)
      )
        continue;
      if (!safe || key.startsWith("on")) el.removeAttribute(attr.name);
    }
  }
  return { html: parsed.head.innerHTML + parsed.body.innerHTML, code };
}
export function pagePublicData(value: unknown) {
  const data = value as
    | {
        collection?: { id?: string; template?: string };
        fields?: Record<string, string>;
        spec?: { fields?: string[] };
        view?: { spec?: { fields?: string[] } };
        records?: { id: string; fields: Record<string, string> }[];
      }
    | undefined;
  const visible =
    data?.spec?.fields ??
    data?.view?.spec?.fields ??
    Object.keys(data?.fields ?? {});
  const project = (fields: Record<string, string>) =>
    Object.fromEntries(
      visible
        .filter((key) => Object.hasOwn(fields, key))
        .map((key) => [key, fields[key]]),
    );
  return {
    collection: data?.collection
      ? { id: data.collection.id, template: data.collection.template }
      : undefined,
    fields: project(data?.fields ?? {}),
    records: (data?.records ?? [])
      .slice(0, 500)
      .map((r) => ({ id: r.id, fields: project(r.fields) })),
  };
}

// This function is serialized into an opaque-origin frame. Keep it self-contained.
function pageFrameRuntime(
  clean: typeof sanitizePageHtml,
  input: { html: string; data: unknown; nonce: string; host: string },
) {
  const surface = document.getElementById("surface")!,
    status = document.getElementById("runtime-status")!;
  let state: unknown = {},
    worker: Worker | undefined,
    sequence = 0;
  const initial = clean(input.html);
  // Programs usually render only content. Keep the page's original stylesheet
  // outside that replaceable surface so data and interaction updates retain it.
  const initialDocument = new DOMParser().parseFromString(initial.html, "text/html");
  for (const style of Array.from(initialDocument.querySelectorAll("style")))
    document.head.appendChild(style);
  const report = (type: string, extra: Record<string, unknown> = {}) =>
    parent.postMessage(
      { channel: "mindos-page", nonce: input.nonce, type, ...extra },
      input.host,
    );
  const resize = () =>
    report("height", {
      height: Math.min(
        1200,
        Math.max(180, document.documentElement.scrollHeight),
      ),
    });
  const display = (html: string) => {
    surface.innerHTML = clean(html).html;
    resize();
  };
  display(initial.html);
  new ResizeObserver(resize).observe(surface);
  function execute(event: unknown = null) {
    if (!initial.code) return;
    worker?.terminate();
    const current = ++sequence;
    const code =
      "self.onmessage=async function(message){const {data,state,event}=message.data;const render=(html,nextState=state)=>self.postMessage({html,state:nextState});try{" +
      initial.code +
      '\n}catch(error){self.postMessage({failure:String(error?.message||"Page program failed")})}}';
    const url = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
    try {
      worker = new Worker(url);
    } catch {
      status.textContent = "动态内容无法运行 / Dynamic content unavailable";
      URL.revokeObjectURL(url);
      return;
    }
    const active = worker;
    const timer = setTimeout(() => {
      active.terminate();
      if (sequence === current) {
        status.textContent = "运行超时，已保留当前页面 / Program timed out";
        resize();
      }
    }, 1500);
    active.onmessage = (message: MessageEvent) => {
      if (sequence !== current) return;
      clearTimeout(timer);
      active.terminate();
      const result = message.data;
      if (
        !result ||
        typeof result.html !== "string" ||
        result.html.length > 131072
      ) {
        status.textContent = "动态内容未能生成 / Dynamic content failed";
        resize();
        return;
      }
      try {
        if (JSON.stringify(result.state).length <= 65536) state = result.state;
      } catch {
        /* Keep last usable local state. */
      }
      status.textContent = "";
      display(result.html);
    };
    active.onerror = () => {
      clearTimeout(timer);
      active.terminate();
      if (sequence === current) {
        status.textContent = "动态内容未能运行 / Dynamic content failed";
        resize();
      }
    };
    active.postMessage({ data: input.data, state, event });
    URL.revokeObjectURL(url);
  }
  surface.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>(
      "button,[data-mindos-action]",
    );
    if (!target) return;
    event.preventDefault();
    const action = target.dataset.mindosAction;
    if (action === "task.complete" || action === "source.open") {
      if (event.isTrusted && target.dataset.recordId)
        report("action", { action, recordId: target.dataset.recordId });
    } else
      execute({
        type: "click",
        id: target.id,
        value: (target as HTMLInputElement).value ?? "",
        dataset: { ...target.dataset },
      });
  });
  surface.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    execute({
      type: "change",
      id: target.id,
      value: target.type === "checkbox" ? String(target.checked) : target.value,
      dataset: { ...target.dataset },
    });
  });
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data;
    if (
      event.source !== parent ||
      event.origin !== input.host ||
      message?.channel !== "mindos-page" ||
      message.nonce !== input.nonce ||
      message.type !== "data"
    )
      return;
    input.data = message.data;
    // A source refresh re-renders with the last committed local state.
    execute(null);
  });
  execute();
  report("ready");
}

export function createPageDocument(
  html: string,
  data: unknown,
  nonce: string,
  host: string,
  theme: Record<string, string>,
) {
  const encode = (value: unknown) =>
    JSON.stringify(value)
      .replaceAll("<", "\\u003c")
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
  const safeNonce = nonce.replace(/[^a-zA-Z0-9-]/g, "");
  const vars = Object.entries(theme)
    .filter(([key, value]) => /^--[a-z-]+$/.test(key) && !/[;{}<>]/.test(value))
    .map(([key, value]) => key + ":" + value)
    .join(";");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${safeNonce}' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>:root{${vars}}*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--background);color:var(--foreground);font-family:system-ui,sans-serif;line-height:1.6;overflow-wrap:anywhere}button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer;border:1px solid var(--border);border-radius:6px;padding:6px 12px;background:var(--muted)}:focus-visible{outline:2px solid var(--ring);outline-offset:2px}img{max-width:100%}#runtime-status{font-size:12px;color:var(--muted-foreground)}</style></head><body><main id="surface"></main><p id="runtime-status" role="status"></p><script nonce="${safeNonce}">(${pageFrameRuntime.toString()})(${sanitizePageHtml.toString()},${encode({ html, data, nonce: safeNonce, host })});</script></body></html>`;
}
