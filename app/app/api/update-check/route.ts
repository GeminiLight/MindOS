export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { gt } from 'semver';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read version from package.json (not process.env.npm_package_version — unavailable in daemon mode)
let current = '0.0.0';
try {
  const pkgPath = resolve(process.cwd(), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  current = pkg.version;
} catch {}

// npm registry sources: prefer China mirror, fallback to official
const REGISTRIES = [
  'https://registry.npmmirror.com/@geminilight/mindos/latest',
  'https://registry.npmjs.org/@geminilight/mindos/latest',
];

export async function GET() {
  let latest = current;

  for (const url of REGISTRIES) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(3000),
        next: { revalidate: 300 }, // 5-minute ISR cache
      });
      if (res.ok) {
        const data = await res.json();
        latest = data.version;
        break;
      }
    } catch {
      continue;
    }
  }

  let hasUpdate = false;
  try {
    hasUpdate = gt(latest, current);
  } catch {
    // Invalid version string from registry — treat as no update
  }

  return NextResponse.json({
    current,
    latest,
    hasUpdate,
  });
}
