// ⚠️ AUTO-GENERATED — DO NOT EDIT. Source: components/explore/use-cases.yaml
// Run `npm run generate` to regenerate.

/** Capability axis — maps to product pillars */
export type UseCaseCategory = 'knowledge-management' | 'memory-sync' | 'auto-execute' | 'experience-evolution' | 'human-insights' | 'audit-control';

/** Scenario axis — maps to user journey phase */
export type UseCaseScenario = 'first-day' | 'daily' | 'project' | 'advanced';

export interface UseCase {
  id: string;
  icon: string;
  image?: string;
  category: UseCaseCategory;
  scenario: UseCaseScenario;
}

export const useCases: UseCase[] = [
  {
    "id": "c1",
    "icon": "👤",
    "category": "memory-sync",
    "scenario": "first-day"
  },
  {
    "id": "c2",
    "icon": "📥",
    "category": "knowledge-management",
    "scenario": "daily"
  },
  {
    "id": "c3",
    "icon": "🔄",
    "category": "memory-sync",
    "scenario": "project"
  },
  {
    "id": "c4",
    "icon": "🔁",
    "category": "experience-evolution",
    "scenario": "daily"
  },
  {
    "id": "c5",
    "icon": "💡",
    "category": "auto-execute",
    "scenario": "daily"
  },
  {
    "id": "c6",
    "icon": "🚀",
    "category": "auto-execute",
    "scenario": "project"
  },
  {
    "id": "c7",
    "icon": "🔍",
    "category": "knowledge-management",
    "scenario": "project"
  },
  {
    "id": "c8",
    "icon": "🤝",
    "category": "human-insights",
    "scenario": "daily"
  },
  {
    "id": "c9",
    "icon": "🛡️",
    "category": "audit-control",
    "scenario": "advanced"
  }
];

export const categories: UseCaseCategory[] = ["knowledge-management","memory-sync","auto-execute","experience-evolution","human-insights","audit-control"];
export const scenarios: UseCaseScenario[] = ["first-day","daily","project","advanced"];
