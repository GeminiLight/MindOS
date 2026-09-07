import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Android autolinking writes one `import <package>.<Class>;` line per dependency into the
 * generated PackageList.java. When a dependency's own `react-native.config.js` fails to
 * load, expo-modules-autolinking silently falls back to guessing that import from the
 * gradle `namespace`, and the guess can name a class that does not exist — the build then
 * dies far downstream in `:app:compileReleaseJavaWithJavac`, ~5 minutes into a cloud
 * build. These tests check every generated import against the classes actually on disk.
 * See ../react-native.config.js for the `expo` override this guards.
 */

const mobileRoot = resolve(__dirname, '..');
const requireFromMobile = createRequire(join(mobileRoot, 'package.json'));

interface AndroidPlatform {
  sourceDir: string;
  packageImportPath: string;
  packageInstance: string;
}

interface AutolinkingConfig {
  dependencies: Record<string, { platforms: { android: AndroidPlatform } }>;
}

let cached: AutolinkingConfig | undefined;

function androidConfig(): AutolinkingConfig {
  if (cached) return cached;
  const expoRoot = dirname(requireFromMobile.resolve('expo/package.json'));
  const bin = createRequire(join(expoRoot, 'package.json')).resolve(
    'expo-modules-autolinking/bin/expo-modules-autolinking.js'
  );
  // Gradle runs this command from a bare `node` process. Vitest exports a NODE_PATH pointing
  // into pnpm's hoisted store, which makes `expo-modules-autolinking` resolvable from the
  // symlinked package path and so papers over the exact failure these tests guard. Drop it.
  const { NODE_PATH: _nodePath, NODE_OPTIONS: _nodeOptions, ...env } = process.env;
  const stdout = execFileSync(
    process.execPath,
    [bin, 'react-native-config', '--json', '--platform', 'android'],
    { cwd: mobileRoot, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 }
  );
  cached = JSON.parse(stdout) as AutolinkingConfig;
  return cached;
}

/** Split `import com.example.FooPackage;` into its Java package and class name. */
function parseImport(importPath: string): { javaPackage: string; className: string } {
  const match = /^import\s+([\w.]+)\.(\w+);$/.exec(importPath.trim());
  if (!match) throw new Error(`unparseable packageImportPath: ${importPath}`);
  return { javaPackage: match[1], className: match[2] };
}

/** Collect matching source files, skipping generated output so stale artifacts can't mask a bad import. */
function findSourceFiles(dir: string, wanted: Set<string>, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'build' || entry.name === '.cxx' || entry.name === 'node_modules') continue;
      findSourceFiles(join(dir, entry.name), wanted, out);
    } else if (wanted.has(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function declaringFiles(platform: AndroidPlatform): string[] {
  const { javaPackage, className } = parseImport(platform.packageImportPath);
  const candidates = findSourceFiles(
    platform.sourceDir,
    new Set([`${className}.kt`, `${className}.java`])
  );
  const declaration = new RegExp(`^\\s*package\\s+${javaPackage.replace(/\./g, '\\.')}\\b`, 'm');
  return candidates.filter((file) => declaration.test(readFileSync(file, 'utf8')));
}

describe('android autolinking', () => {
  it('links the expo package through expo.modules.ExpoModulesPackage', () => {
    // Regression: pnpm's layout made expo/react-native.config.js unloadable, so autolinking
    // guessed `expo.core.ExpoModulesPackage` from the gradle namespace and the APK build failed.
    const expo = androidConfig().dependencies.expo;
    expect(expo).toBeDefined();
    expect(expo.platforms.android.packageImportPath).toBe('import expo.modules.ExpoModulesPackage;');
  });

  it('generates imports that resolve to real classes for every linked dependency', () => {
    const dependencies = Object.entries(androidConfig().dependencies);
    expect(dependencies.length).toBeGreaterThan(0);

    const unresolved = dependencies
      .filter(([, dependency]) => declaringFiles(dependency.platforms.android).length === 0)
      .map(([name, dependency]) => `${name}: ${dependency.platforms.android.packageImportPath}`);

    expect(unresolved).toEqual([]);
  });

  it('keeps each import in step with the package instance it constructs', () => {
    for (const [name, dependency] of Object.entries(androidConfig().dependencies)) {
      const { packageImportPath, packageInstance } = dependency.platforms.android;
      const { className } = parseImport(packageImportPath);
      expect(packageInstance, `${name} constructs a class it does not import`).toBe(
        `new ${className}()`
      );
    }
  });
});
