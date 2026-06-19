import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const BUILTIN_AGENT_EXTENSION_PACKAGES = [
  '@juicesharp/rpiv-ask-user-question',
  'pi-mcp-adapter',
  'pi-schedule-prompt',
  'pi-subagents',
  'pi-web-access',
] as const;

export type BuiltinAgentExtensionPackage = typeof BUILTIN_AGENT_EXTENSION_PACKAGES[number];

export function resolveWebAppDirFromEntry(entryImportMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(entryImportMetaUrl)), '..', '..');
}

export function getMindosWebRuntimeSourceDirCandidates(
  webAppDir: string | undefined,
): string[] {
  const candidates: string[] = [];
  const add = (candidate: string | undefined) => {
    if (!candidate) return;
    const normalized = path.resolve(candidate);
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  if (webAppDir) {
    add(webAppDir);
    add(path.join(webAppDir, '.next', 'standalone'));
  }

  const cwd = process.cwd();
  add(cwd);
  add(path.join(cwd, 'packages', 'web'));

  const projectRoot = process.env.MINDOS_PROJECT_ROOT;
  if (projectRoot) {
    add(path.join(projectRoot, 'packages', 'web'));
    add(path.join(projectRoot, 'packages', 'web', '.next', 'standalone'));
    add(path.join(projectRoot, '_standalone'));
  }

  return candidates;
}

export function resolveMindosWebRuntimeSourcePath(
  webAppDir: string | undefined,
  ...segments: string[]
): string {
  for (const sourceDir of getMindosWebRuntimeSourceDirCandidates(webAppDir)) {
    const candidate = path.join(sourceDir, ...segments);
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }

  const [fallbackSourceDir] = getMindosWebRuntimeSourceDirCandidates(webAppDir);
  return path.join(fallbackSourceDir ?? process.cwd(), ...segments);
}

export function getBuiltinWebRuntimePackageDirCandidates(
  webAppDir: string | undefined,
  packageName: string,
): string[] {
  const candidates: string[] = [];
  const add = (candidate: string | undefined) => {
    if (!candidate) return;
    const normalized = path.resolve(candidate);
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  if (webAppDir) {
    add(path.join(webAppDir, '.next', 'standalone', 'node_modules', packageName));
    add(path.join(webAppDir, 'node_modules', packageName));
  }

  const cwd = process.cwd();
  add(path.join(cwd, 'node_modules', packageName));
  add(path.join(cwd, '__node_modules', packageName));
  add(path.join(cwd, '.next', 'standalone', 'node_modules', packageName));

  const projectRoot = process.env.MINDOS_PROJECT_ROOT;
  if (projectRoot) {
    add(path.join(projectRoot, 'packages', 'web', '.next', 'standalone', 'node_modules', packageName));
    add(path.join(projectRoot, 'packages', 'web', 'node_modules', packageName));
    add(path.join(projectRoot, '_standalone', 'node_modules', packageName));
    add(path.join(projectRoot, '_standalone', '__node_modules', packageName));
  }

  return candidates;
}

export function findBuiltinWebRuntimePackagePath(
  webAppDir: string | undefined,
  packageName: BuiltinAgentExtensionPackage,
  ...segments: string[]
): string | null {
  for (const packageDir of getBuiltinWebRuntimePackageDirCandidates(webAppDir, packageName)) {
    const candidate = path.join(packageDir, ...segments);
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  return null;
}

export function resolveBuiltinWebRuntimePackagePath(
  webAppDir: string | undefined,
  packageName: BuiltinAgentExtensionPackage,
  ...segments: string[]
): string {
  const found = findBuiltinWebRuntimePackagePath(webAppDir, packageName, ...segments);
  if (found) return found;

  const [fallbackPackageDir] = getBuiltinWebRuntimePackageDirCandidates(webAppDir, packageName);
  return path.join(fallbackPackageDir ?? path.join(process.cwd(), 'node_modules', packageName), ...segments);
}
