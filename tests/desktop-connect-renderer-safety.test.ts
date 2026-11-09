import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf-8');

// The connect surface was split during the desktop shell refactor: the renderer
// builds the panels, the shared DOM helpers own the i18n and status sinks. The
// invariant is about the *surface*, not about which file holds it, so assert
// across both and say which one each property belongs to.
const renderer = read('packages/desktop/src/connect-renderer.ts');
const dom = read('packages/desktop/src/connect-dom.ts');
const sources: Array<[string, string]> = [
  ['connect-renderer.ts', renderer],
  ['connect-dom.ts', dom],
];

describe('desktop connect surface HTML safety', () => {
  it('never assigns interpolated markup to innerHTML', () => {
    // Command output, server addresses and SSH host names all reach these
    // surfaces; none of them may be parsed as markup.
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/\.innerHTML\s*=\s*`/);
      expect(source, name).not.toMatch(/\.innerHTML\s*=\s*[^'"\n]*\$\{/);
      expect(source, name).not.toContain('statusEl.innerHTML =');
    }
  });

  it('assigns innerHTML only from the static theme icon literals', () => {
    const assignments = [...renderer.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(assignments).toEqual([
      "getEffectiveColorScheme() === 'dark' ? ICON_MOON : ICON_SUN",
    ]);
    // Pin the icons as interpolation-free literals, so the assignment above
    // cannot become a sink by someone templating a variable into the icon.
    for (const icon of ['ICON_SUN', 'ICON_MOON']) {
      const declaration = renderer.match(new RegExp(`const ${icon} =\\s*\\n?\\s*('[^']*'|"[^"]*");`));
      expect(declaration, icon).not.toBeNull();
      expect(declaration![1], icon).not.toContain('${');
    }
    expect(dom).not.toContain('.innerHTML =');
  });

  it('keeps exactly one markup sink, behind the translation allowlist', () => {
    expect(renderer).not.toContain('insertAdjacentHTML(');

    const inserts = [...dom.matchAll(/insertAdjacentHTML\(/g)];
    expect(inserts).toHaveLength(1);
    const guard = dom.indexOf('HTML_I18N_KEYS.has(key)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(dom.indexOf('insertAdjacentHTML('));
  });

  it('renders status descriptors through text nodes', () => {
    expect(dom).toContain('function renderStatus(');
    expect(dom).toContain('el.replaceChildren(document.createTextNode(');
    expect(dom).toContain('detail.textContent = desc.detail');
  });

  it('renders saved connection labels and addresses as text', () => {
    expect(renderer).toContain('labelEl.textContent = conn.label || conn.address');
    expect(renderer).toContain('addrEl.textContent = conn.address');
  });
});
