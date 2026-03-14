import fs from 'fs';
import path from 'path';

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

  // templates/ is at the repo root (sibling of app/)
  const repoRoot = path.resolve(process.cwd(), '..');
  const templateDir = path.join(repoRoot, 'templates', template);

  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template "${template}" not found at ${templateDir}`);
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  copyRecursive(templateDir, destDir);
}
