export const ECHO_CARD_SEGMENTS = ['imprint', 'insight', 'promotion'] as const;
export type EchoCardSegment = (typeof ECHO_CARD_SEGMENTS)[number];

export type EchoCardKind = 'digest' | 'moment' | 'pattern' | 'judgment' | 'playbook' | 'practice';

export type EchoCardSourceMessageRef = {
  messageIndex: number;
  role: string;
  quote: string;
};

export type EchoCardSourceSession = {
  id: string;
  title?: string;
  runtime?: string;
  createdAt?: number;
  updatedAt?: number;
  messageRefs?: EchoCardSourceMessageRef[];
};

export type EchoCardSource = {
  label: string;
  sessions: EchoCardSourceSession[];
};

export type EchoGenerationTrigger = 'auto' | 'manual';
export type EchoScheduleMode = 'manual' | 'daily' | 'interval';
export type EchoOutputLocale = 'en' | 'zh';
export type EchoGenerationMode = 'deterministic' | 'lm';

export type EchoSchedule = {
  mode: EchoScheduleMode;
  dailyTime: string;
  intervalHours: number;
};

export type EchoScheduleStatus = EchoSchedule & {
  due: boolean;
  nextRunAt?: string;
};

export type EchoCardGeneration = {
  method: EchoGenerationMode;
  trigger: EchoGenerationTrigger;
  locale: EchoOutputLocale;
  taskId?: string;
  promptVersion?: string;
};

export type EchoCard = {
  id: string;
  segment: EchoCardSegment;
  kind: EchoCardKind;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  source: EchoCardSource;
  confidence: number;
  status: 'active' | 'deleted';
  generatedAt: string;
  generation: EchoCardGeneration;
  userEdited?: boolean;
};

export type EchoSegmentGenerationState = {
  checkpointAt?: string;
  lastGeneratedAt?: string;
  lastTrigger?: EchoGenerationTrigger;
  lastGenerationMode?: EchoGenerationMode;
  lastGenerationError?: string;
  schedule: EchoSchedule;
  runCount: number;
  windowMinutes: number;
};

export type EchoCardsState = {
  schemaVersion: 1;
  segments: Record<EchoCardSegment, EchoSegmentGenerationState>;
  cards: EchoCard[];
};

export function normalizeEchoCardSegment(value: unknown): EchoCardSegment | null {
  return typeof value === 'string' && ECHO_CARD_SEGMENTS.includes(value as EchoCardSegment)
    ? value as EchoCardSegment
    : null;
}

export function normalizeEchoCardLocale(value: unknown): EchoOutputLocale {
  return value === 'zh' ? 'zh' : 'en';
}
