import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Build integrity tests — ensure the production build output is self-consistent,
 * so users can actually load the GUI without broken CSS/JS references.
 *
 * These tests inspect the `.next` build output directly (no running server needed).
 * They catch the class of bug where HTML references assets with hash X but the
 * actual files have hash Y (e.g. after a partial rebuild or cache corruption).
 */

const APP_DIR = path.resolve(__dirname, '..', '..', 'app');
const NEXT_DIR = path.join(APP_DIR, '.next');

// Skip all tests if no build output exists (CI or dev without build)
const hasBuild = fs.existsSync(NEXT_DIR);

describe.skipIf(!hasBuild)('build integrity', () => {
  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Recursively collect all files matching a predicate */
  function walkFiles(dir: string, filter: (f: string) => boolean): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkFiles(full, filter));
      } else if (filter(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }

  /** Extract /_next/static/... references from file content */
  function extractStaticRefs(content: string): string[] {
    const refs: string[] = [];
    // Match /_next/static/chunks/xxx.css and /_next/static/chunks/xxx.js
    const pattern = /\/_next\/static\/[^\s"'`)]+?\.(css|js)/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      refs.push(m[0]);
    }
    return refs;
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('build output directory exists with required subdirs', () => {
    expect(fs.existsSync(path.join(NEXT_DIR, 'static'))).toBe(true);
    expect(fs.existsSync(path.join(NEXT_DIR, 'server'))).toBe(true);
  });

  it('has at least one CSS file in static output', () => {
    const cssFiles = walkFiles(path.join(NEXT_DIR, 'static'), f => f.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('has at least one JS chunk in static output', () => {
    const jsFiles = walkFiles(path.join(NEXT_DIR, 'static'), f => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('all /_next/static references in server output resolve to actual files', () => {
    // Scan server-rendered HTML/RSC files for /_next/static/... references
    const serverFiles = walkFiles(path.join(NEXT_DIR, 'server'), f =>
      f.endsWith('.html') || f.endsWith('.body') || f.endsWith('.rsc') || f.endsWith('.meta') || f.endsWith('.js')
    );

    const allRefs = new Set<string>();
    const missing: string[] = [];

    for (const file of serverFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const ref of extractStaticRefs(content)) {
        allRefs.add(ref);
      }
    }

    for (const ref of allRefs) {
      // /_next/static/chunks/xxx.css → .next/static/chunks/xxx.css
      const onDisk = path.join(NEXT_DIR, ref.replace(/^\/_next\//, ''));
      if (!fs.existsSync(onDisk)) {
        missing.push(ref);
      }
    }

    // If we found references, none should be missing
    if (allRefs.size > 0) {
      expect(missing).toEqual([]);
    }
  });

  it('CSS files are non-empty and contain valid content', () => {
    const cssFiles = walkFiles(path.join(NEXT_DIR, 'static'), f => f.endsWith('.css'));
    for (const file of cssFiles) {
      const stat = fs.statSync(file);
      expect(stat.size, `CSS file should not be empty: ${path.basename(file)}`).toBeGreaterThan(0);
      // Basic sanity: should contain CSS-like content (selectors, properties)
      const content = fs.readFileSync(file, 'utf-8');
      expect(
        content.includes('{') && content.includes('}'),
        `CSS file should contain valid CSS rules: ${path.basename(file)}`
      ).toBe(true);
    }
  });

  it('build manifest exists and is valid JSON', () => {
    const manifestPath = path.join(NEXT_DIR, 'build-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest).toHaveProperty('pages');
  });

  it('build manifest page assets all exist on disk', () => {
    const manifestPath = path.join(NEXT_DIR, 'build-manifest.json');
    if (!fs.existsSync(manifestPath)) return;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const missing: string[] = [];

    for (const [page, assets] of Object.entries(manifest.pages || {})) {
      for (const asset of (assets as string[])) {
        // Assets in manifest are relative paths like _next/static/chunks/xxx.js
        const onDisk = path.join(NEXT_DIR, asset.replace(/^_next\//, ''));
        if (!fs.existsSync(onDisk)) {
          missing.push(`${page} → ${asset}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
