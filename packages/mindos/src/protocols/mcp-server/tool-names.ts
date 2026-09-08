/**
 * Names of every tool the MindOS MCP server registers, in registration order.
 *
 * `index.ts` is bundled with the MCP SDK and cannot be imported by the Web /
 * product server, so the list lives here as a dependency-free module. The
 * source-contract test in `tool-names.test.ts` keeps it in sync with the
 * `registerTool(` calls in `index.ts`.
 */

export const MINDOS_MCP_TOOL_NAMES = [
  'mindos_list_files',
  'mindos_list_spaces',
  'mindos_read_file',
  'mindos_write_file',
  'mindos_create_file',
  'mindos_batch_create_files',
  'mindos_create_space',
  'mindos_rename_space',
  'mindos_delete_file',
  'mindos_rename_file',
  'mindos_move_file',
  'mindos_search_notes',
  'mindos_get_recent',
  'mindos_read_lines',
  'mindos_insert_lines',
  'mindos_update_lines',
  'mindos_append_to_file',
  'mindos_insert_after_heading',
  'mindos_update_section',
  'mindos_append_csv',
  'mindos_get_backlinks',
  'mindos_bootstrap',
  'mindos_get_history',
  'mindos_get_file_at_version',
  'mindos_lint',
  'mindos_dreaming',
  'mindos_compile',
] as const;

export type MindosMcpToolName = (typeof MINDOS_MCP_TOOL_NAMES)[number];

export const MINDOS_MCP_TOOL_COUNT: number = MINDOS_MCP_TOOL_NAMES.length;
