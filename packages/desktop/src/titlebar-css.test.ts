import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Contract for the macOS titlebar-row shell (spec-titlebar-row Phase 1):
// the legacy injected-CSS drag band is gone; geometry is owned by the Web
// layer via CSS variables, and the shell only declares capability + state.
describe('desktop macOS titlebar shell contract', () => {
  const mainSource = readFileSync(path.join(__dirname, 'main.ts'), 'utf-8');
  const preloadSource = readFileSync(path.join(__dirname, 'preload.ts'), 'utf-8');

  it('no longer injects the legacy titlebar CSS band', () => {
    expect(mainSource).not.toContain('--electron-mac-titlebar-h');
    expect(mainSource).not.toContain('body::before');
    expect(mainSource).not.toContain('.electron-mac-titlebar-pad');
    expect(mainSource).not.toContain('insertCSS');
  });

  it('centers traffic lights in the 46px titlebar row', () => {
    expect(mainSource).toMatch(/trafficLightPosition[\s\S]{0,80}\{\s*x:\s*12,\s*y:\s*17\s*\}/);
  });

  it('forwards fullscreen state and resends it on every load', () => {
    expect(mainSource).toContain("'enter-full-screen'");
    expect(mainSource).toContain("'leave-full-screen'");
    expect(mainSource).toContain("'mindos:mac-fullscreen'");
    // did-finish-load must rebuild the attribute: navigation creates a fresh document
    const didFinishBlock = mainSource.slice(mainSource.indexOf("webContents.on('did-finish-load'"));
    expect(didFinishBlock).toContain('isFullScreen()');
  });

  it('preload exposes the shell capability flag and fullscreen attribute toggle', () => {
    expect(preloadSource).toContain('mindosShell');
    expect(preloadSource).toContain('macTitlebarRow');
    expect(preloadSource).toContain("'mindos:mac-fullscreen'");
    expect(preloadSource).toContain('data-mac-fullscreen');
  });
});
