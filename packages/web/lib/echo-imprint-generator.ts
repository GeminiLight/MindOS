import {
  activeEchoCards,
  deleteEchoCard,
  generateEchoCards,
  generateEchoCardsWithAi,
  getEchoCardScheduleStatus,
  readEchoCardsState,
  updateEchoCard,
  updateEchoCardSchedule,
} from './echo-card-generator';
import type {
  EchoCard,
  EchoCardsState,
  EchoGenerationTrigger,
  EchoOutputLocale,
  EchoSchedule,
  EchoScheduleMode,
  EchoScheduleStatus,
  EchoSegmentGenerationState,
} from './echo-cards';
import type { GenerateEchoCardsInput, GenerateEchoCardsWithAiInput } from './echo-card-generator';

export type ImprintGenerationTrigger = EchoGenerationTrigger;
export type ImprintScheduleMode = EchoScheduleMode;
export type ImprintOutputLocale = EchoOutputLocale;
export type ImprintSchedule = EchoSchedule;
export type ImprintScheduleStatus = EchoScheduleStatus;
export type ImprintCardKind = 'digest' | 'moment';
export type ImprintCard = EchoCard & { segment: 'imprint'; kind: ImprintCardKind };
export type ImprintGenerationState = EchoSegmentGenerationState & {
  schemaVersion: 1;
  cards: ImprintCard[];
};
export type GenerateImprintsInput = Omit<GenerateEchoCardsInput, 'segment'>;
export type GenerateImprintsWithAiInput = Omit<GenerateEchoCardsWithAiInput, 'segment'>;
export type ImprintGenerationResult = Omit<Awaited<ReturnType<typeof generateEchoCardsWithAi>>, 'state' | 'cards'> & {
  state: ImprintGenerationState;
  cards: ImprintCard[];
};

export function readImprintGenerationState(mindRoot: string): ImprintGenerationState {
  return imprintStateFromCardsState(readEchoCardsState(mindRoot));
}

export function generateImprints(input: GenerateImprintsInput) {
  const result = generateEchoCards({
    ...input,
    segment: 'imprint',
  });
  return imprintResultFromCardsResult(result);
}

export async function generateImprintsWithAi(input: GenerateImprintsWithAiInput): Promise<ImprintGenerationResult> {
  const result = await generateEchoCardsWithAi({
    ...input,
    segment: 'imprint',
  });
  return imprintResultFromCardsResult(result);
}

export function updateImprintSchedule(mindRoot: string, patch: unknown): ImprintGenerationState {
  return imprintStateFromCardsState(updateEchoCardSchedule(mindRoot, 'imprint', patch));
}

export function getImprintScheduleStatus(
  state: Pick<ImprintGenerationState, 'schedule' | 'lastGeneratedAt'>,
  now = new Date(),
): ImprintScheduleStatus {
  return getEchoCardScheduleStatus(state, now);
}

export function updateImprintCard(
  mindRoot: string,
  cardId: string,
  patch: { title?: unknown; content?: unknown },
  now = new Date(),
): ImprintCard | null {
  return updateEchoCard(mindRoot, 'imprint', cardId, patch, now) as ImprintCard | null;
}

export function deleteImprintCard(mindRoot: string, cardId: string, now = new Date()): ImprintCard | null {
  return deleteEchoCard(mindRoot, 'imprint', cardId, now) as ImprintCard | null;
}

export function activeCards(state: ImprintGenerationState | EchoCardsState): ImprintCard[] {
  if ('segments' in state) return activeEchoCards(state, 'imprint') as ImprintCard[];
  return state.cards
    .filter((card) => card.status === 'active')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 5);
}

export function normalizeImprintLocale(value: unknown): ImprintOutputLocale {
  return value === 'zh' ? 'zh' : 'en';
}

function imprintStateFromCardsState(state: EchoCardsState): ImprintGenerationState {
  return {
    schemaVersion: state.schemaVersion,
    ...state.segments.imprint,
    cards: state.cards.filter((card): card is ImprintCard => (
      card.segment === 'imprint' && (card.kind === 'digest' || card.kind === 'moment')
    )),
  };
}

function imprintResultFromCardsResult(
  result: Awaited<ReturnType<typeof generateEchoCardsWithAi>>,
): ImprintGenerationResult {
  return {
    ...result,
    state: imprintStateFromCardsState(result.state),
    cards: result.cards.filter((card): card is ImprintCard => (
      card.segment === 'imprint' && (card.kind === 'digest' || card.kind === 'moment')
    )),
  };
}
