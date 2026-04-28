/**
 * JSONC parser — strips BOM and comments before JSON.parse.
 *
 * VS Code-based editors (Cursor, Windsurf, Cline) use JSONC for config files.
 * Windows editors (Notepad) may prepend a UTF-8 BOM (\uFEFF).
 */

export function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

export const parseJsonc = (text) => {
  let stripped = stripBom(text).replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (m, g) => g ? '' : m);
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!stripped.trim()) return {};
  return JSON.parse(stripped);
};
