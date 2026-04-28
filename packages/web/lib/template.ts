import fs from 'fs';
import path from 'path';
import { getProjectRoot } from './project-root';

/**
 * Recursively copy `src` to `dest`, skipping files that already exist in dest.
 */
export function copyRecursive(src: string, dest: string) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    // Skip if file already exists
    if (fs.existsSync(dest)) return;
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/**
 * Apply a built-in template (en / zh / empty) to the given directory.
 * Returns true on success, throws on error.
 */
export function applyTemplate(template: string, destDir: string): void {
  if (!['en', 'zh', 'empty'].includes(template)) {
    throw new Error(`Invalid template: ${template}`);
  }

  // templates/ lives at the repo/project root (sibling of app/).
  // In standalone mode process.cwd() is .next/standalone/ — unreliable for relative paths.
  // MINDOS_PROJECT_ROOT is set by Desktop ProcessManager and CLI startup.
  const projectRoot = getProjectRoot();
  const candidates = [
    path.join(projectRoot, 'templates', template),
    path.resolve(process.cwd(), '..', 'templates', template),
    path.resolve(process.cwd(), 'templates', template),
  ];
  const templateDir = candidates.find((d) => fs.existsSync(d));
  if (!templateDir) {
    throw new Error(`Template "${template}" not found at ${candidates.join(', ')}`);
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  copyRecursive(templateDir, destDir);
}
