/** Capability axis — maps to product pillars */
export type UseCaseCategory = 'memory-sync' | 'auto-execute' | 'experience-evolution' | 'audit-control';

/** Scenario axis — maps to user journey phase */
export type UseCaseScenario = 'first-day' | 'daily' | 'project' | 'advanced';

export interface UseCase {
  id: string;
  icon: string;
  category: UseCaseCategory;
  scenario: UseCaseScenario;
}

/**
 * C1-C9 use case definitions.
 * All display text (title, description, prompt) comes from i18n — this file is structure only.
 *
 * Category (capability axis):
 *   memory-sync         — Record once, all Agents know
 *   auto-execute        — One sentence, auto-execute
 *   experience-evolution — Gets smarter with use
 *   audit-control       — You have final say
 *
 * Scenario (journey axis):
 *   first-day — Onboarding / first-time tasks
 *   daily     — Everyday workflows
 *   project   — Project-scoped work
 *   advanced  — Power-user patterns
 */
export const useCases: UseCase[] = [
  { id: 'c1', icon: '👤', category: 'memory-sync',          scenario: 'first-day' },
  { id: 'c2', icon: '📥', category: 'memory-sync',          scenario: 'daily' },
  { id: 'c3', icon: '🔄', category: 'memory-sync',          scenario: 'project' },
  { id: 'c4', icon: '🔁', category: 'experience-evolution', scenario: 'daily' },
  { id: 'c5', icon: '💡', category: 'auto-execute',         scenario: 'daily' },
  { id: 'c6', icon: '🚀', category: 'auto-execute',         scenario: 'project' },
  { id: 'c7', icon: '🔍', category: 'auto-execute',         scenario: 'project' },
  { id: 'c8', icon: '🤝', category: 'experience-evolution', scenario: 'daily' },
  { id: 'c9', icon: '🛡️', category: 'audit-control',       scenario: 'advanced' },
];

export const categories: UseCaseCategory[] = [
  'memory-sync',
  'auto-execute',
  'experience-evolution',
  'audit-control',
];

export const scenarios: UseCaseScenario[] = [
  'first-day',
  'daily',
  'project',
  'advanced',
];
