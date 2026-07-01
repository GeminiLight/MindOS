import type {
  EchoSchedule,
  EchoScheduleStatus,
  EchoSegmentGenerationState,
} from './echo-cards';

export const DEFAULT_ECHO_CARD_SCHEDULE: EchoSchedule = {
  mode: 'daily',
  dailyTime: '20:00',
  intervalHours: 24,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 24;

export function getEchoCardScheduleStatus(
  state: Pick<EchoSegmentGenerationState, 'schedule' | 'lastGeneratedAt'>,
  now = new Date(),
): EchoScheduleStatus {
  const schedule = normalizeEchoCardSchedule(state.schedule);
  if (schedule.mode === 'manual') {
    return { ...schedule, due: false };
  }

  const lastGeneratedAt = typeof state.lastGeneratedAt === 'string' && isValidDate(state.lastGeneratedAt)
    ? Date.parse(state.lastGeneratedAt)
    : null;
  if (lastGeneratedAt === null) {
    return { ...schedule, due: true, nextRunAt: now.toISOString() };
  }

  if (schedule.mode === 'interval') {
    const nextRun = new Date(lastGeneratedAt + schedule.intervalHours * 60 * 60_000);
    const due = now.getTime() >= nextRun.getTime();
    return {
      ...schedule,
      due,
      nextRunAt: (due ? now : nextRun).toISOString(),
    };
  }

  const scheduledToday = dailyScheduleDate(now, schedule.dailyTime);
  const due = now.getTime() >= scheduledToday.getTime() && lastGeneratedAt < scheduledToday.getTime();
  const nextRunAt = due
    ? now
    : now.getTime() < scheduledToday.getTime()
      ? scheduledToday
      : addDays(scheduledToday, 1);
  return {
    ...schedule,
    due,
    nextRunAt: nextRunAt.toISOString(),
  };
}

export function normalizeEchoCardSchedule(
  value: unknown,
  base: EchoSchedule = DEFAULT_ECHO_CARD_SCHEDULE,
): EchoSchedule {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode = record.mode === 'manual' || record.mode === 'daily' || record.mode === 'interval'
    ? record.mode
    : base.mode;
  const dailyTime = typeof record.dailyTime === 'string' && TIME_RE.test(record.dailyTime)
    ? record.dailyTime
    : base.dailyTime;
  const intervalHours = typeof record.intervalHours === 'number' && Number.isFinite(record.intervalHours)
    ? clampIntervalHours(record.intervalHours)
    : base.intervalHours;
  return {
    mode,
    dailyTime,
    intervalHours,
  };
}

export function normalizeEchoCardWindowMinutes(value: unknown, schedule: EchoSchedule): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return defaultEchoCardWindowMinutes(schedule);
}

export function defaultEchoCardWindowMinutes(schedule: EchoSchedule): number {
  if (schedule.mode === 'interval') return schedule.intervalHours * 60;
  return 24 * 60;
}

function clampIntervalHours(value: number): number {
  return Math.max(MIN_INTERVAL_HOURS, Math.min(MAX_INTERVAL_HOURS, Math.round(value)));
}

function dailyScheduleDate(now: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);
  return scheduled;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
