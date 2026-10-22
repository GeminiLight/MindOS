---
name: mindos-views
description: Manage shared local people and project tasks, or generate a reusable MindOS table, list or board. Use when the user asks to maintain contacts, follow-ups, project tasks, or change how local information is displayed.
---

# MindOS shared work views

Use the six `mindos_views_*` MCP tools. If MCP is unavailable, use `mindos views` with a JSON file or stdin. Never bypass this workflow by editing the registry, CSV, or Markdown directly. The same runtime, root and original files are shared by Codex, Claude Code and the human UI.

1. Call `mindos_views_describe` and require `capabilityVersion: 1`. If unavailable, run the packaged setup skill. Never install `latest` on each session or create a second library to fix a connection.
2. Read the existing views and collections first. Reuse a matching collection. Creation requires a user-requested folder and an operation UUID; choose `people` or `tasks`, and `new` or `existing`. Do not automatically migrate arbitrary CSV or TODO.md.
3. Read current records and schema before editing. Keep `rootId`, record source revision, schema revision, collection ID, record ID and a fresh UUID for each intended mutation. Never use row position as identity. Forward all expected revisions. For task creation, include the collection file revision; for a new person, omit the content revision.
4. Use only supported actions: `record.create`, `record.update`, `interaction.add`, `followup.update`, `schema.extend`, `operation.undo`. For optional task text fields use a new `x_` key. Explain the new field and empty initial values before the user-authorized change. Preserve unknown/private content; structured read is intentionally a field projection, not all source text.
5. To generate a UI, use the current field catalogue and construct a small ViewSpec: `specVersion: 1`, `collectionId`, `layout`, `fields`, optional `sort`, `filter.all`, `labels`, and `actions`. Layouts: `list-detail`, `table`, `board`; board groups task `status`. Never generate HTML, React, JavaScript, CSS, SQL, URLs or executable actions. Labels are text. Dates use YYYY-MM-DD. Filters have at most 10 conditions and sort at most 2 fields.
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
