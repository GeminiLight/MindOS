/**
 * Re-export shell: the config-format facade (JSONC in-place edits, key
 * safety, atomic writes, per-format dispatch) now lives in
 * `agent/config/formats.ts`, where the CLI bundle picks it up as well.
 */
export * from '../../agent/config/formats.js';
