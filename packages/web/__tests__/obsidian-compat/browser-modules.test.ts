// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { OBSIDIAN_BROWSER_MODULES } from '@/lib/obsidian-compat/runtime-plan';
import { createBrowserModuleRegistry } from '@/lib/obsidian-compat/browser-host/modules';
describe('browser module registry',()=>{
 it('provides exactly the advertised externals with the live editor state identity',()=>{
  const api={Plugin:class{}};const modules=createBrowserModuleRegistry(api);
  expect(Object.keys(modules).sort()).toEqual([...OBSIDIAN_BROWSER_MODULES].sort());
  expect(modules.obsidian).toBe(api);expect(modules['@codemirror/state'].EditorState).toBe(EditorState);
  expect(modules['@codemirror/autocomplete'].autocompletion).toBeTypeOf('function');
  expect(modules['@lezer/highlight'].tags).toBeDefined();
  expect(Object.hasOwn(modules,'fs')).toBe(false);
  const state = EditorState.create({ doc: 'hello', extensions: [
    modules['@codemirror/autocomplete'].autocompletion(),
    modules['@codemirror/search'].search(),
    modules['@codemirror/lint'].linter(() => []),
  ] });
  const query = new modules['@codemirror/search'].SearchQuery({ search: 'hello' });
  const updated = state.update({ effects: modules['@codemirror/search'].setSearchQuery.of(query) }).state;
  expect(modules['@codemirror/search'].getSearchQuery(updated).search).toBe('hello');
 });
});
