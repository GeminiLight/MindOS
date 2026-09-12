/** Browser-safe catalogue shared by preflight and the actual isolated loader.
 * Adding a module requires a real module mapping and the registry contract test.
 */
export const OBSIDIAN_BROWSER_MODULES = [
  'obsidian', '@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/commands',
  '@codemirror/autocomplete', '@codemirror/search', '@codemirror/lint',
  '@lezer/common', '@lezer/highlight', '@lezer/lr',
] as const;
export type ObsidianBrowserModule = typeof OBSIDIAN_BROWSER_MODULES[number];
const available = new Set<string>(OBSIDIAN_BROWSER_MODULES);
type Report = { moduleImports?: string[]; unsupportedModules?: string[]; unsupportedApis?: string[]; blockers: string[] };

/** A static candidate is never an execution result or permission grant. */
export function planObsidianExecution(report: Report) {
  const modules = report.moduleImports ?? report.unsupportedModules;
  const missing = [...new Set((modules ?? []).filter(name => !available.has(name)))];
  const dynamicRequire = report.blockers.some(reason => reason.includes('dynamic require'));
  const desktopCandidate = modules !== undefined && missing.length === 0 && !dynamicRequire;
  return {
    evidence: 'static' as const,
    serverCandidate: report.blockers.length === 0 && (report.unsupportedApis?.length ?? 0) === 0,
    desktopCandidate,
    desktopMissingModules: missing,
    warnings: [...report.blockers.filter(reason => !reason.startsWith('Requires unsupported runtime module: ')),
      ...(report.unsupportedApis ?? []).map(api => `API needs runtime verification: ${api}`)],
  };
}
