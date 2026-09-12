import { describe, expect, it } from 'vitest';
import { analyzePluginCompatibility } from '@/lib/obsidian-compat/compatibility-report';
import { getObsidianImportSupport } from '@/lib/obsidian-compat/import-policy';
import { planObsidianExecution } from '@/lib/obsidian-compat/runtime-plan';
import { buildObsidianCompatibilityPreview } from '@/lib/obsidian-compat/compatibility-preview';

describe('host-specific execution planning', () => {
  it('allows inert installation of browser extensions without enabling them in the server', () => {
    const report = analyzePluginCompatibility("const {Plugin}=require('obsidian'); const {ViewPlugin}=require('@codemirror/view');");
    expect(planObsidianExecution(report)).toMatchObject({ desktopCandidate: true, serverCandidate: false });
    expect(getObsidianImportSupport({ compatibilityLevel: 'blocked', compatibility: report })).toMatchObject({
      importable: true, defaultSelected: false, kind: 'review', label: 'Desktop editor',
    });
  });
  it('keeps dynamic imports visible as review concerns without forbidding an inert browser package', () => {
    const report = analyzePluginCompatibility("require('@codemirror/language'); const lazy=(s)=>import(s);");
    expect(planObsidianExecution(report)).toMatchObject({ desktopCandidate: true, serverCandidate: false });
    expect(planObsidianExecution(report).warnings).toContainEqual(expect.stringContaining('dynamic import'));
  });
  it('does not mistake a bundled dependency optional member probe for the host require function', () => {
    const report = analyzePluginCompatibility("require('@codemirror/view'); const probe=(()=>{try{return localModule && localModule.require && localModule.require('util').types}catch{}})();");
    expect(report.moduleImports).toEqual(['@codemirror/view']);
    expect(planObsidianExecution(report).desktopCandidate).toBe(true);
    expect(planObsidianExecution(analyzePluginCompatibility("require('util');")).desktopCandidate).toBe(false);
  });
  it.each(['fs', 'electron', 'missing-package', '@codemirror/not-installed', '../outside'])('does not advertise unavailable module %s as a Desktop candidate', name => {
    const report = analyzePluginCompatibility(`require('@codemirror/view');require('${name}');`);
    expect(planObsidianExecution(report).desktopCandidate).toBe(false);
  });
  it('handles empty plugins without claiming observed execution', () => {
    expect(planObsidianExecution(analyzePluginCompatibility(''))).toMatchObject({ serverCandidate: true, desktopCandidate: true, evidence: 'static' });
  });
  it('keeps import review and next steps consistent with the Desktop host choice', () => {
    const preview = buildObsidianCompatibilityPreview({
      id: 'generic-editor', manifest: { id: 'generic-editor', name: 'Editor', version: '1.0.0' },
      sourceDir: '/tmp/unused', hasStyles: false, hasData: false, compatibilityLevel: 'blocked',
      compatibility: analyzePluginCompatibility("require('@codemirror/view');"),
      obsidianConfig: { enabledInObsidian: true, hotkeys: [], hotkeyCount: 0 },
    }, { sourcePluginsPath: '.obsidian/plugins' });
    expect(preview.blockedReasons).toEqual([]);
    expect(preview.importDecision).toMatchObject({ action: 'import-package-only', label: 'Desktop editor review', importable: true, enableAfterImport: false });
    expect(preview.nextSteps.join(' ')).toContain('Desktop experimental editor');
    expect(preview.nextSteps.join(' ')).not.toContain('Enable from Installed');
    expect(preview.warnings.join(' ')).toContain('Server runtime');
  });
});
