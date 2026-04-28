export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getProjectRoot } from '@/lib/project-root';

/**
 * Read version from the published product package.
 * Tries multiple paths to handle dev, production, and standalone builds.
 */
function readVersion(): string {
  // 1. Env var set by CLI (most reliable)
  if (process.env.npm_package_version) return process.env.npm_package_version;

  // 2. Try known product package locations.
  const projectRoot = getProjectRoot();
  const candidates = [
    join(projectRoot, 'packages', 'mindos', 'package.json'), // repo dev
    join(projectRoot, 'package.json'),                       // installed package
    join(process.cwd(), 'package.json'),                      // standalone edge case
  ];

  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf-8'));
      if (pkg.name === '@geminilight/mindos' && pkg.version) return pkg.version;
    } catch { /* try next */ }
  }
  return '0.0.0';
}

const version = readVersion();

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function GET() {
  const res = NextResponse.json({
    ok: true,
    service: 'mindos',
    version,
    authRequired: !!process.env.WEB_PASSWORD,
  });
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
