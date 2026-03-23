import { describe, it, expect } from 'vitest';
import { useCases, categories, scenarios, type UseCaseCategory, type UseCaseScenario } from '@/components/explore/use-cases';

describe('explore/use-cases', () => {
  it('defines 9 use cases (C1-C9)', () => {
    expect(useCases).toHaveLength(9);
  });

  it('each use case has id, icon, valid category, and valid scenario', () => {
    for (const uc of useCases) {
      expect(uc.id).toMatch(/^c[1-9]$/);
      expect(uc.icon).toBeTruthy();
      expect(categories).toContain(uc.category);
      expect(scenarios).toContain(uc.scenario);
    }
  });

  it('has unique IDs', () => {
    const ids = useCases.map(u => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defines exactly 6 categories', () => {
    expect(categories).toHaveLength(6);
    expect(categories).toEqual([
      'knowledge-management',
      'memory-sync',
      'auto-execute',
      'experience-evolution',
      'human-insights',
      'audit-control',
    ]);
  });

  it('defines exactly 4 scenarios', () => {
    expect(scenarios).toHaveLength(4);
    expect(scenarios).toEqual([
      'first-day',
      'daily',
      'project',
      'advanced',
    ]);
  });

  it('every category has at least one use case', () => {
    for (const cat of categories) {
      const count = useCases.filter(u => u.category === cat).length;
      expect(count).toBeGreaterThan(0);
    }
  });

  it('every scenario has at least one use case', () => {
    for (const sc of scenarios) {
      const count = useCases.filter(u => u.scenario === sc).length;
      expect(count).toBeGreaterThan(0);
    }
  });

  it('C1 is memory-sync + first-day', () => {
    const c1 = useCases.find(u => u.id === 'c1');
    expect(c1?.category).toBe('memory-sync');
    expect(c1?.scenario).toBe('first-day');
  });

  it('C9 is audit-control + advanced', () => {
    const c9 = useCases.find(u => u.id === 'c9');
    expect(c9?.category).toBe('audit-control');
    expect(c9?.scenario).toBe('advanced');
  });
});
