import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeBreadcrumbVisibility } from '@/components/Breadcrumb';

describe('Breadcrumb header UX', () => {
  it('keeps breadcrumb on a single row and exposes an ellipsis affordance', () => {
    const filePath = path.resolve(process.cwd(), 'components/Breadcrumb.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('flex-nowrap');
    expect(source).toContain('MoreHorizontal');
    expect(source).toContain('Show hidden folders');
    expect(source).toContain('truncate max-w-[180px] sm:max-w-[260px] md:max-w-[360px]');
    expect(source).toContain("const BREADCRUMB_HOME_HREF = '/wiki';");
    expect(source).not.toContain('flex-wrap');
  });

  it('collapses middle segments only when the available width is constrained', () => {
    const parts = ['MIND_QI', '调研库', 'WikiGraph', 'Implementation', 'Deep Dive', 'README.md'];

    expect(computeBreadcrumbVisibility(parts, 1200)).toEqual({
      visible: [0, 1, 2, 3, 4, 5],
      hidden: [],
    });

    const compact = computeBreadcrumbVisibility(parts, 280);
    expect(compact.visible).toContain(5);
    expect(compact.hidden.length).toBeGreaterThan(0);
    expect(compact.visible.length + compact.hidden.length).toBe(parts.length);
  });
});
