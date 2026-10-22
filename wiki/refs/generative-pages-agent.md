# AI-editable work pages and agent workflow

Work pages combine existing people, tasks and notes. They are stored as PageSpec v1 and keep business data in its original Markdown/CSV. Changing or restoring a layout never restores source records. Temporary previews do not enter navigation; only explicitly saved pages appear under `/studio/pages`.

## Human workflow

Open Views → My work pages → New page. Describe the page you want, or select sources and add blocks manually. Select a block before asking AI for a local edit. A locked block stays unchanged; unlock it to edit. AI returns a preview, which you may apply or discard before saving. Manual editing and saved pages work without an AI provider. Configure a provider in Settings to enable page generation.

The model receives the current page specification and a bounded source catalog (names, IDs and field schema), not every underlying record. Source text or old HTML in the page is treated as data. Requests are cancellable and bounded to 90 seconds, with at most one repair for malformed model JSON. Invalid output never replaces the saved page.

## Unified Codex / Claude Code plugin

1. Use `mindos_views_describe`; require `pages.specVersion === 1`. Read collections with `mindos_views_read` and pages with `mindos_pages_read`. Reuse existing sources and pages instead of duplicating them.
2. Produce a PageSpec. Use stable block IDs. `collectionId` directly binds a source; `viewId` deliberately inherits a saved view's fields, filters and actions. Do not broaden that saved projection. Notes use explicit relative folder or file paths.
3. Call `mindos_pages_preview` with `expectedRootId` and `spec`. Inspect block errors and limits before saving. This operation does not add navigation or modify source files.
4. When page creation or adjustment is authorized, call `mindos_pages_save` with `operationId` UUID, `expectedRootId`, `expectedVersion`, and `spec`. New pages use version 0; edits also send `pageId` and the latest version. Respect locked blocks and the scope requested by the user.
5. Read the saved page back. Open `/studio/pages/<pageId>` or use `mindos views page.open <pageId>`. Return the actual result; do not claim an unsaved preview is saved.
6. Restore using `mindos_pages_save` with `action: "restore"`, `restoreVersion`, and current `expectedVersion`. Remove only the page with `action: "remove"`; source records remain. On uncertainty retry the identical request and operation ID. On version conflict reread and compare; never silently overwrite.

CLI equivalents: `mindos views page.list`, `page.read <page-id>`, `page.preview --input page.json`, `page.save --input save.json`, `page.restore --input restore.json`, and `page.remove --input remove.json`. JSON may be supplied on stdin. `page.generate --input request.json` asks the configured MindOS model for an unsaved candidate; external agents can instead author the specification themselves and use preview/save.

## Page specification

```json
{
  "specVersion": 1,
  "title": "Project momentum",
  "description": "Decisions, people and the next steps in one place.",
  "layout": { "columns": 2, "density": "comfortable" },
  "blocks": [
    { "id": "next-steps", "title": "Next steps", "kind": "tasks", "collectionId": "c-replace-with-real-id", "fields": ["title", "status", "dueDate", "personRef"], "filter": { "all": [{ "field": "status", "op": "neq", "value": "done" }] } },
    { "id": "team", "title": "People", "kind": "people", "collectionId": "c-replace-with-real-people-id", "locked": true }
  ]
}
```

Use IDs from discovery, never the placeholders above. The page supports `tasks`, `people`, `notes`, `summary`, and `html` blocks. Each block has a unique stable `id` and `title`. Optional `layout` chooses list-detail/table/board where supported. At most 12 blocks and 128 KiB of serialized specification are allowed. Page history retains up to 20 earlier layouts. Visible result limits and partial failures are reported per block.

## Custom web blocks

An `html` block holds local HTML/CSS and optionally binds a collection. It runs in the isolated page renderer. Ordinary script tags, inline event handlers and external resources are not executed. Dynamic content uses the supported worker script:

```html
<script type="mindos/page">
const count = data.records.filter(record => record.fields.status !== 'done').length;
render('<section><h2>' + count + ' open tasks</h2><p>A clear next step makes progress easier.</p></section>');
</script>
```

Worker globals are `data` (`records`, `fields`, `collection`), `state`, `event`, and `render(html, nextState?)`. The worker has no DOM or networking; execution is bounded. `event` is null or `{type:'click'|'change',id,value,dataset}` from an identified control. Returned HTML is sanitized before display. Escape values from records when inserting them into HTML. Use supported CSS variables such as `--background`, `--foreground`, `--muted-foreground`, `--border`, and `--amber`.

Compute the next state before building the displayed HTML, then pass that same state to `render`. For example: `const next = {count: (Number(state.count) || 0) + (event?.id === 'increment' ? 1 : 0)}; render('<p>'+next.count+'</p><button id="increment">+1</button>', next);`. Rendering the old counter while returning an incremented state makes the display lag one click. Original page styles are retained across dynamic renders. Inspect both initial content and interactions in the preview before saving generated programs.

A button with `data-mindos-action="task.complete"` and `data-record-id="<actual record id>"` requests a host-validated task completion; `source.open` requests opening that source. Custom code does not receive arbitrary file access, credentials, raw mutation APIs or network access. Do not use `<script src>`, CDN imports, Node APIs or assume a full browser application environment. This is an isolated custom page capability, not unrestricted application execution.
