import { describe, it, expect } from 'vitest';
import { parseLogHint } from '../../bin/lib/gateway.js';

describe('parseLogHint', () => {
  // ── npm install lines ──
  it('detects "Installing app dependencies"', () => {
    expect(parseLogHint('Installing app dependencies (first run)...\n')).toBe('installing dependencies…');
  });

  it('detects "Updating app dependencies"', () => {
    expect(parseLogHint('Updating app dependencies (package-lock.json changed)...\n')).toBe('updating dependencies…');
  });

  it('detects "added N packages"', () => {
    expect(parseLogHint('added 387 packages in 12s')).toBe('dependencies installed');
  });

  it('detects "Installing MCP dependencies"', () => {
    expect(parseLogHint('Installing MCP dependencies (first run)...\n')).toBe('installing MCP…');
  });

  // ── next build lines ──
  it('detects "Building MindOS"', () => {
    expect(parseLogHint('Building MindOS (first run or new version detected)...\n')).toBe('building app…');
  });

  it('detects "Creating an optimized production build"', () => {
    expect(parseLogHint('   Creating an optimized production build ...')).toBe('building app…');
  });

  it('detects "Compiling"', () => {
    expect(parseLogHint(' ✓ Compiled /api/health in 320ms')).toBe('compiling…');
  });

  it('detects "Collecting page data"', () => {
    expect(parseLogHint('   Collecting page data ...')).toBe('collecting page data…');
  });

  it('detects "Generating static pages"', () => {
    expect(parseLogHint('   Generating static pages (0/8) ...')).toBe('generating pages…');
  });

  it('detects "Finalizing page optimization"', () => {
    expect(parseLogHint('   Finalizing page optimization ...')).toBe('optimizing…');
  });

  it('detects route bundle lines', () => {
    expect(parseLogHint('├ ○ /api/health                        0.3 kB')).toBe('bundling routes…');
  });

  // ── next start lines ──
  it('detects Next.js banner', () => {
    expect(parseLogHint('▲ Next.js 15.2.4')).toBe('starting server…');
  });

  it('detects "Ready in"', () => {
    expect(parseLogHint('   Ready in 1.8s')).toBe('starting server…');
  });

  // ── should NOT match ──
  it('returns null for empty lines', () => {
    expect(parseLogHint('')).toBeNull();
    expect(parseLogHint('   ')).toBeNull();
  });

  it('returns null for npm warn/error lines', () => {
    // These don't match any pattern since we removed the error catch-all
    expect(parseLogHint('npm warn deprecated inflight@1.0.6')).toBeNull();
  });

  it('returns null for stack trace lines', () => {
    expect(parseLogHint('    at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)')).toBeNull();
  });

  it('returns null for random log lines', () => {
    expect(parseLogHint('Server listening on port 3456')).toBeNull();
    expect(parseLogHint('[MCP] Request: tools/list')).toBeNull();
  });

  // "Installing MCP dependencies" should match MCP, not generic dependencies
  it('prioritizes MCP match for MCP dependencies line', () => {
    // The line contains both "Installing" and "MCP dependencies"
    // "Installing MCP dependencies" should match the MCP-specific rule
    expect(parseLogHint('Installing MCP dependencies (first run)...')).toBe('installing MCP…');
  });
});
