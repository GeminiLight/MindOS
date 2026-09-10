/**
 * Shared plugin-install primitives.
 *
 * Used by both plugin-shaped install paths: the agent runtime extension
 * handler (`server/handlers/runtime-extensions.ts`) and the Obsidian
 * community plugin installer (`web/lib/obsidian-compat/community-install.ts`).
 * See `wiki/specs/spec-plugin-primitives.md`.
 */

export * from './safe-id.js';
export * from './staged-install.js';
export * from './confirmation-receipt.js';
