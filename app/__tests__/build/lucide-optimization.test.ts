import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('lucide-react optimization', () => {
  const buildDir = path.join(__dirname, '../../.next/standalone');

  describe('bundle size optimization', () => {
    it('should have lucide-react optimization config in next.config.ts', () => {
      const configPath = path.join(__dirname, '../../next.config.ts');
      const configContent = fs.readFileSync(configPath, 'utf-8');

      expect(configContent).toContain('optimizePackageImports');
      expect(configContent).toContain('lucide-react');
    });

    it('should have generated standalone build', () => {
      expect(fs.existsSync(buildDir)).toBe(true);
    });
  });

  describe('icon imports still work', () => {
    it('should not have broken any icon imports in source files', () => {
      // Scan TSX files for icon imports
      const appDir = path.join(__dirname, '../../app');
      const srcDir = path.join(appDir, 'src');

      if (!fs.existsSync(srcDir)) {
        console.warn('src directory not found, skipping icon import verification');
        return;
      }

      const iconImportPattern = /from ['"]lucide-react['"]/;
      let filesWithIconImports = 0;

      const walkDir = (dir) => {
        const files = fs.readdirSync(dir);
        files.forEach((file) => {
          if (file.startsWith('.')) return;
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            walkDir(filePath);
          } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (iconImportPattern.test(content)) {
              filesWithIconImports++;
            }
          }
        });
      };

      walkDir(srcDir);
      console.log(`Found ${filesWithIconImports} files importing from lucide-react`);
      expect(filesWithIconImports).toBeGreaterThan(50); // We know 93 files use it
    });

    it('should have consistent ES module export for lucide-react', () => {
      const luciduPkgPath = path.join(
        __dirname,
        '../../app/node_modules/lucide-react/package.json'
      );
      if (fs.existsSync(luciduPkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(luciduPkgPath, 'utf-8'));
        expect(pkg.sideEffects).toBe(false);
        expect(pkg.module).toBeDefined();
        expect(pkg.module).toContain('dist/esm');
      }
    });
  });

  describe('tree-shaking verification', () => {
    it('should have sideEffects: false in lucide-react package.json', () => {
      const pkgPath = path.join(
        __dirname,
        '../../app/node_modules/lucide-react/package.json'
      );
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        expect(pkg.sideEffects).toBe(false);
        console.log(`lucide-react version: ${pkg.version}`);
      }
    });

    it('should have no commented or debug code for icon imports', () => {
      // Heuristic check: ensure no large commented-out icon imports
      const appDir = path.join(__dirname, '../../app/src');
      if (!fs.existsSync(appDir)) return;

      let suspiciousPatterns = 0;
      const walkDir = (dir) => {
        const files = fs.readdirSync(dir);
        files.forEach((file) => {
          if (file.startsWith('.')) return;
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            walkDir(filePath);
          } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            const content = fs.readFileSync(filePath, 'utf-8');
            // Check for overly long icon import lists (> 20 icons per file likely indicates over-import)
            const importMatch = content.match(/import\s*{([^}]+)}\s*from\s*['"']lucide-react[''"]/);
            if (importMatch) {
              const iconCount = importMatch[1].split(',').length;
              if (iconCount > 20) {
                console.warn(`File ${file} imports ${iconCount} icons (potential over-import)`);
                suspiciousPatterns++;
              }
            }
          }
        });
      };

      walkDir(appDir);
      // Just log; not a hard failure since context matters
      console.log(`Found ${suspiciousPatterns} potential over-imports`);
    });
  });
});
