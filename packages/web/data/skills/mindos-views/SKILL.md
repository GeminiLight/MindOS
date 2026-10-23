---
name: mindos-views
description: Manage shared local people and project tasks, generate reusable tables or boards, and compose/customize multi-source MindOS work pages with isolated custom HTML. Use when the user asks to maintain contacts, follow-ups or tasks, build a personal dashboard, or adjust a page with AI.
---

# MindOS shared work views

Use the `mindos_views_*` tools for records/single-source views and `mindos_pages_*` for multi-source work pages. If MCP is unavailable, use `mindos views` with a JSON file or stdin. Never bypass this workflow by editing the registry, CSV, or Markdown directly. The same runtime, root and original files are shared by Codex, Claude Code and the human UI.

1. Call `mindos_views_describe` and require `capabilityVersion: 1`. If unavailable, run the packaged setup skill. Never install `latest` on each session or create a second library to fix a connection.
2. Read the existing views and collections first. Reuse a matching collection. Creation requires a user-requested folder and an operation UUID; choose `people` or `tasks`, and `new` or `existing`. Do not automatically migrate arbitrary CSV or TODO.md.
3. Read current records and schema before editing. Keep `rootId`, record source revision, schema revision, collection ID, record ID and a fresh UUID for each intended mutation. Never use row position as identity. Forward all expected revisions. For task creation, include the collection file revision; for a new person, omit the content revision.
4. Use only supported actions: `record.create`, `record.update`, `interaction.add`, `followup.update`, `schema.extend`, `operation.undo`. For optional task text fields use a new `x_` key. Explain the new field and empty initial values before the user-authorized change. Preserve unknown/private content; structured read is intentionally a field projection, not all source text.
5. To generate a UI, use the current field catalogue and construct a small ViewSpec: `specVersion: 1`, `collectionId`, `layout`, `fields`, optional `sort`, `filter.all`, `labels`, and `actions`. Layouts: `list-detail`, `table`, `board`; board groups task `status`. For a ViewSpec, never generate HTML, React, JavaScript, CSS, SQL, URLs or executable actions; custom HTML belongs only in a PageSpec html block below. Labels are text. Dates use YYYY-MM-DD. Filters have at most 10 conditions and sort at most 2 fields.
6. Example requests: “按状态分组显示项目待办，隐藏已完成” → board/groupBy status/filter neq done; “按姓名排序的人脉表格” → table/name, background, focus/sort name asc. Call preview first and show its URL. Save if the user already authorized the adjustment; otherwise let them inspect the preview. Use expectedViewVersion when replacing a saved view. `copy`, `restore`, `remove` change views only; removing never deletes original records.
7. Read back after saving and report the actual source path, view URL and committed result. URLs returned by tools are relative to the connected MindOS origin; `mindos views open <view-id>` validates and opens them. Never put bearer tokens into URLs.
8. On conflict, preserve the intended edit, re-read and compare; do not silently retry with a fresh revision. On timeout, query `mindos_views_read` with the SAME operationId; retry the IDENTICAL request. Never change input under the same ID. A successful receipt confirms that operation, not that later edits are absent. Undo updates only while the source still matches the saved after revision; creation cannot be undone.

CLI examples (JSON output):

```sh
mindos views doctor
mindos views list
mindos views describe c-collection-id
mindos views read c-collection-id
mindos views create --input request.json
mindos views mutate --input request.json
mindos views preview --input request.json
mindos views save --input request.json
mindos views operation operation-uuid
mindos views open v-view-id
```

All write JSON includes `expectedRootId`; mutation/create/save includes `operationId`. A server failure is not permission to write files directly. The plugin adds no model account and does not send messages or publish content. It cannot isolate a malicious local agent that already has filesystem access.


## Composable work pages

For a dashboard, combined project page or a custom webpage, require `describe.pages.specVersion: 1`. Discover source IDs with `mindos_views_read` and existing pages with `mindos_pages_read`. Reuse the intended page instead of creating another navigation entry.

- A PageSpec is `{specVersion:1,title,description?,layout:{columns:1|2,density:"comfortable"|"compact"},blocks:[...]}`. Each block has a stable `id`, `title`, and `kind` (`tasks`, `people`, `notes`, `summary`, `html`). At most12 blocks, 128KiB total. Use real discovered IDs.
- `collectionId` binds a source directly; `viewId` explicitly inherits saved fields/filters/actions and must not broaden them. Optional `fields`, `filter`, `layout`, and `limit` control presentation. Notes bind explicit relative `folder` or `paths`. Keep private/unknown source content intact. Do not infer Studio Project identity from a task-folder name.
- Preserve unchanged blocks and IDs when editing. Preserve `locked:true` blocks unless the user explicitly requests unlocking/changing them. When the user selects one block, change only that block.
- Call `mindos_pages_preview({expectedRootId,spec})` and inspect block errors/limits. Previews do not persist or enter navigation. Then, when authorized, `mindos_pages_save({action:"save",expectedRootId,operationId,expectedVersion,spec,pageId?})`; use version0 for a new page and the current version for an existing page. Read back and return `/studio/pages/<pageId>` on the connected origin.
- Restore layout with `mindos_pages_save({action:"restore",expectedRootId,operationId,pageId,expectedVersion,restoreVersion})`. Remove only its entry with `action:"remove"`. Neither operation restores/deletes underlying task or person data. On uncertainty retry the identical page request/operationId; do not query the record-operation receipt endpoint for a page operation. On conflict reread and compare, never silently overwrite.
- CLI equivalents are `mindos views page.list`, `page.read <page-id>`, `page.preview --input request.json`, `page.save --input request.json`, `page.restore --input request.json`, `page.remove --input request.json`, and `page.open <page-id>`.

### Isolated custom web block

Set `kind:"html"` with an `html` string and optional collection binding. Static HTML/CSS is supported. Ordinary scripts, inline event handlers, CDN imports, arbitrary React execution, networking and DOM APIs are unavailable. For dynamic content use `<script type="mindos/page">…</script>` running in an isolated worker. Globals: `data={records:[{id,fields}],fields,collection}`, `state`, `event` (null or `{type,id,value,dataset}`), and `render(html,nextState?)`. Example: `render('<h2>'+data.records.length+' tasks</h2>')`. Escape data strings before embedding them in HTML. Rendered output is sanitized.

Controls with `id` emit local worker events. `data-mindos-action="task.complete"` or `"source.open"` plus `data-record-id="<real-id>"` request host-validated actions. Never fabricate record IDs or bypass the host API. Use supplied CSS variables and responsive layouts. A custom page cannot access credentials or arbitrary files.

The external Agent can author and preview the PageSpec without another model account. The page UI's own AI adjustment and optional `mindos views page.generate --input request.json` use the user's configured MindOS provider, return an unsaved candidate, and require a usable configuration. Do not claim unsupported or failed generation succeeded.


## Durable Studio project work

Require `describe.projects` before using project operations. Discover existing project identities through `mindos_projects_read({})`; read one with `{projectId}`. New Studio projects use stable UUID identities. Existing legacy Studio slugs remain supported. A name match never authorizes merging identities or relationships.

- Save explicitly intended relationships with `mindos_projects_write({action:"save",expectedRootId,operationId,expectedVersion,project:{id,title,goal,taskCollectionIds,personRefs}})`. Use version 0 only for a new project. Each task collection has one project owner; people may participate in multiple projects. Link at most four task collections and forty people from at most four people collections.
- `action:"open-page"` with `{projectId,expectedRootId}` opens or creates that project's stable default work page and reconciles changed sources while retaining presentation. Return `/studio/pages/<returned page.id>`. Opening repeatedly does not create duplicates. Removing the default page lets a subsequent explicit open create a new default identity; the retired page is never resurrected.
- PageSpec may contain `projectId` and `projectSources`. Preserve both during layout/AI edits. The current project relationships determine data scope; changing page HTML cannot broaden it. Keep selected and locked regions stable. Project source changes and layout history are separate from source business data.
- Record project communication with `action:"conversation"`, `projectId`, `personRef`, `text`, calendar `date`, `expectedVersion` (project), `expectedRevision` and `expectedSchemaRevision` (person), `expectedRootId`, and `operationId`. Read revisions first. The server writes the original person's Markdown and adds a project marker; do not maintain another transcript file or tag private interactions automatically. Reuse the identical operation ID after an uncertain response, then read back.
- CLI equivalents: `mindos views project.list`, `project.read <projectId>`, `project.save --input request.json`, `project.page <projectId> --input request.json`, `project.interact <projectId> --input request.json`.

Project name, goal and relationships are in the current library. Existing WorkDir/Space/AI defaults remain browser configuration; do not claim those defaults have migrated or silently replace them. Project timelines are bounded and show only currently linked people; unlinking never deletes their original records.
