import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Breadcrumb header UX', () => {
  it('keeps breadcrumb on a single row and truncates long labels', () => {
    const filePath = path.resolve(process.cwd(), 'components/Breadcrumb.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('flex-nowrap overflow-hidden');
    expect(source).toContain('truncate max-w-[180px] sm:max-w-[260px] md:max-w-[360px]');
    expect(source).not.toContain('flex-wrap');
  });
});
