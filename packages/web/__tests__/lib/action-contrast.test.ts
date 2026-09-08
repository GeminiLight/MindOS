import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

const css = readFileSync('app/globals.css', 'utf8');
const home = readFileSync('components/HomeContent.tsx', 'utf8');
function rgb(hex: string) { return hex.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16)); }
function luminance(values: number[]) {
  return values.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a: number[], b: number[]) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function token(block: string, name: string) {
  const value = block.match(new RegExp(`--${name}:\\s*(#[a-f\\d]{6})`, 'i'))?.[1];
  expect(value, `${name} must have a defined semantic token`).toBeTruthy();
  return rgb(value!);
}

describe('primary action and reading contrast', () => {
  it.each(['ObsidianImportSection', 'ObsidianPluginHostSection'])('uses readable action colors in %s', component => {
    const source = readFileSync(`components/settings/${component}.tsx`, 'utf8');
    expect(source).not.toMatch(/className="[^"]*bg-\[var\(--amber\)\][^"]*text-\[var\(--amber-foreground\)\]/);
  });
  it('keeps mobile toolbar focus below the safe-area boundary without shrinking targets', () => {
    const shell = readFileSync('components/SidebarLayout.tsx', 'utf8');
    expect(shell).toContain('mobile-app-header');
    expect(css).toContain('padding-top: calc(env(safe-area-inset-top, 0px) + 4px)');
    expect(css).toContain('--mobile-header-height: calc(53px + env(safe-area-inset-top, 0px))');
  });
  it('reserves scroll room for focus outlines and the fixed mobile toolbar', () => {
    const focus = css.slice(css.indexOf('/* Global focus-visible')).split('}')[0];
    expect(focus).toContain('scroll-margin: 8px');
    expect(css).toContain('scroll-padding-block: 8px');
    expect(css).toContain('scroll-padding-top: calc(var(--mobile-header-height) + 8px)');
  });
  it('does not animate focus from a half-opacity outline', () => {
    expect(css).not.toContain('outline-ring/50');
  });
  it('reserves focus space at constrained navigation edges', () => {
    expect(home).toContain('-mt-1');
    expect(home).toContain('px-1 pt-1 pb-1');
    const rail = readFileSync('components/ActivityBar.tsx', 'utf8');
    expect(rail).toContain('[--focus-ring-offset:-3px]');
    expect(rail).toContain('[--focus-ring-width:3px]');
    expect(css).toContain('var(--focus-ring-offset, 2px)');
    const tabs = readFileSync('components/TitlebarTabStrip.tsx', 'utf8');
    expect(tabs).toContain('mb-1 ml-1 mr-1 flex h-7 w-7');
  });
  it.each([':root', '.dark'])('keeps keyboard focus distinguishable on standard surfaces in %s', selector => {
    const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    const value = block.match(/--ring:\s*([^;]+);/)![1];
    const ink = value.startsWith('var(') ? token(block, value.slice(6, -1)) : rgb(value);
    for (const name of ['background', 'card', 'popover', 'muted', 'accent', 'sidebar']) {
      expect(contrast(ink, token(block, name)), `${selector} focus on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not add a translucent second focus halo to shared buttons', () => {
    for (const variant of ['default', 'amber', 'destructive'] as const) {
      expect(buttonVariants({ variant })).not.toMatch(/focus-visible:ring-(?:3|ring\/50)/);
    }
  });

  it('preserves control shape when keyboard focus appears', () => {
    const block = css.slice(css.indexOf('/* Global focus-visible')).split('}')[0];
    expect(block).not.toContain('border-radius');
    expect(block).toContain('var(--ring)');
    for (const selector of ['input', 'textarea', 'select', 'summary', '[tabindex]']) expect(block).toContain(selector);
  });
  it.each(['components/ImportModal.tsx', 'components/home/InboxSection.tsx', 'components/renderers/workflow-yaml/WorkflowYamlRenderer.tsx', 'components/renderers/workflow-yaml/WorkflowRunner.tsx'])('does not fade actionable error copy in %s', path => {
    expect(readFileSync(path, 'utf8')).not.toMatch(/text-(?:error|\[var\(--error\)\])\/\d+/);
  });
  it.each([':root', '.dark'])('keeps success and error messages readable across standard and tinted surfaces in %s', selector => {
    const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    for (const name of ['success', 'error']) {
      const ink = token(block, name);
      for (const surfaceName of ['background', 'card', 'popover', 'muted', 'accent', 'sidebar']) {
        const surface = token(block, surfaceName);
        for (const opacity of [0, 0.1, 0.2]) {
          const background = surface.map((value, index) => value * (1 - opacity) + ink[index] * opacity);
          expect(contrast(ink, background), `${selector} ${name} on ${surfaceName}, tint ${opacity}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps destructive soft actions on the readable error text palette', () => {
    const destructive = buttonVariants({ variant: 'destructive' });
    expect(destructive).toContain('text-error');
    expect(destructive).not.toContain('text-destructive');
    expect(destructive).not.toContain('bg-destructive');
  });

  it('does not use text-status colors as solid white-text action backgrounds', () => {
    const uninstall = readFileSync('components/settings/UninstallTab.tsx', 'utf8');
    const install = readFileSync('components/panels/AgentsPanelAgentListRow.tsx', 'utf8');
    expect(uninstall).toContain('bg-destructive text-destructive-foreground');
    expect(uninstall).not.toContain('bg-error text-destructive-foreground');
    expect(install).not.toContain('text-white');
    expect(install).toContain('bg-error/10 text-error');
    expect(install).toContain('bg-success/10 text-success');
    expect(install).toContain('[--amber:var(--amber-action)]');
  });
  it.each([':root', '.dark'])('keeps white action text readable in %s, including the translucent hover', selector => {
    const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    const action = token(block, 'amber-action');
    const foreground = token(block, 'amber-foreground');
    const surface = token(block, 'background');
    expect(contrast(action, foreground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(action.map((value, i) => value * 0.9 + surface[i] * 0.1), foreground)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the action token within the shared amber button without darkening decorative amber', () => {
    expect(buttonVariants({ variant: 'amber' })).toContain('[--amber:var(--amber-action)]');
    expect(css).toContain('--color-amber-action: var(--amber-action)');
  });

  it('does not fade homepage labels and descriptions into disabled-looking text', () => {
    expect(home).not.toMatch(/text-muted-foreground\/(20|40|50|60)/);
  });
});
