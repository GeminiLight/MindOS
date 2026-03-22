export type UseCaseCategory = 'getting-started' | 'cross-agent' | 'knowledge-evolution' | 'advanced';

export interface UseCase {
  id: string;
  icon: string;
  category: UseCaseCategory;
}

/**
 * C1-C9 use case definitions.
 * All display text (title, description, prompt) comes from i18n — this file is structure only.
 */
export const useCases: UseCase[] = [
  { id: 'c1', icon: '👤', category: 'getting-started' },
  { id: 'c2', icon: '📥', category: 'getting-started' },
  { id: 'c3', icon: '🔄', category: 'cross-agent' },
  { id: 'c4', icon: '🔁', category: 'knowledge-evolution' },
  { id: 'c5', icon: '💡', category: 'cross-agent' },
  { id: 'c6', icon: '🚀', category: 'cross-agent' },
  { id: 'c7', icon: '🔍', category: 'knowledge-evolution' },
  { id: 'c8', icon: '🤝', category: 'knowledge-evolution' },
  { id: 'c9', icon: '🛡️', category: 'advanced' },
];

export const categories: UseCaseCategory[] = [
  'getting-started',
  'cross-agent',
  'knowledge-evolution',
  'advanced',
];
