import { describe, it, expect } from 'vitest';
import { useCases, categories, type UseCaseCategory } from '@/components/explore/use-cases';

describe('explore/use-cases', () => {
  it('defines 9 use cases (C1-C9)', () => {
    expect(useCases).toHaveLength(9);
  });

  it('each use case has id, icon, and valid category', () => {
    for (const uc of useCases) {
      expect(uc.id).toMatch(/^c[1-9]$/);
      expect(uc.icon).toBeTruthy();
      expect(categories).toContain(uc.category);
    }
  });

  it('has unique IDs', () => {
    const ids = useCases.map(u => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defines exactly 4 categories', () => {
    expect(categories).toHaveLength(4);
    expect(categories).toEqual([
      'getting-started',
      'cross-agent',
      'knowledge-evolution',
      'advanced',
    ]);
  });

  it('every category has at least one use case', () => {
    for (const cat of categories) {
      const count = useCases.filter(u => u.category === cat).length;
      expect(count).toBeGreaterThan(0);
    }
  });

  it('C1 and C2 are in getting-started', () => {
    expect(useCases.find(u => u.id === 'c1')?.category).toBe('getting-started');
    expect(useCases.find(u => u.id === 'c2')?.category).toBe('getting-started');
  });

  it('C9 is in advanced', () => {
    expect(useCases.find(u => u.id === 'c9')?.category).toBe('advanced');
  });
});
