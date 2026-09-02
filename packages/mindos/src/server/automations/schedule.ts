import type { RuntimeControlPlaneTrigger } from '../handlers/runtime-control-plane.js';
import type { StudioAutomationSchedule } from './types.js';

export const DEFAULT_AUTOMATION_TIMEZONE = 'Asia/Shanghai';

export function automationTrigger(schedule: StudioAutomationSchedule, timezone: string): RuntimeControlPlaneTrigger {
  if (schedule === 'manual') return { type: 'manual', timezone };
  return { type: 'cron', cron: automationCron(schedule), timezone };
}

export function automationCron(schedule: Exclude<StudioAutomationSchedule, 'manual'>): string {
  switch (schedule) {
    case 'hourly': return '0 0 * * * *';
    case 'every-2-hours': return '0 0 */2 * * *';
    case 'every-4-hours': return '0 0 */4 * * *';
    case 'daily-0900': return '0 0 9 * * *';
    case 'daily-1800': return '0 0 18 * * *';
    case 'twice-daily': return '0 0 9,18 * * *';
    case 'weekdays-0900': return '0 0 9 * * 1-5';
    case 'weekdays-1800': return '0 0 18 * * 1-5';
    case 'weekly-monday-0900': return '0 0 9 * * 1';
    case 'weekly-friday-1730':
    case 'weekly-review': return '0 30 17 * * 5';
    case 'monthly-first-0900': return '0 0 9 1 * *';
    case 'monthly-last-1700': return '0 0 17 L * *';
  }
}

export function nextAutomationRunAt(
  schedule: StudioAutomationSchedule,
  after: Date,
  timezone = DEFAULT_AUTOMATION_TIMEZONE,
): string | undefined {
  if (schedule === 'manual') return undefined;
  assertValidTimezone(timezone);
  const local = localParts(after, timezone);
  const calendarStart = Date.UTC(local.year, local.month - 1, local.day);

  for (let dayOffset = 0; dayOffset <= 400; dayOffset += 1) {
    const calendar = new Date(calendarStart + dayOffset * 86_400_000);
    const year = calendar.getUTCFullYear();
    const month = calendar.getUTCMonth() + 1;
    const day = calendar.getUTCDate();
    const weekday = calendar.getUTCDay();
    if (!matchesScheduleDay(schedule, year, month, day, weekday)) continue;
    for (const [hour, minute] of scheduleTimes(schedule)) {
      const candidate = zonedDateTimeToUtc({ year, month, day, hour, minute }, timezone);
      if (candidate.getTime() > after.getTime()) return candidate.toISOString();
    }
  }
  throw new Error(`Could not calculate next automation run for ${schedule}.`);
}

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid automation timezone: ${timezone}`);
  }
}

function matchesScheduleDay(
  schedule: StudioAutomationSchedule,
  year: number,
  month: number,
  day: number,
  weekday: number,
): boolean {
  if (schedule === 'weekdays-0900' || schedule === 'weekdays-1800') return weekday >= 1 && weekday <= 5;
  if (schedule === 'weekly-monday-0900') return weekday === 1;
  if (schedule === 'weekly-friday-1730' || schedule === 'weekly-review') return weekday === 5;
  if (schedule === 'monthly-first-0900') return day === 1;
  if (schedule === 'monthly-last-1700') return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
  return true;
}

function scheduleTimes(schedule: StudioAutomationSchedule): Array<[number, number]> {
  if (schedule === 'hourly') return Array.from({ length: 24 }, (_, hour) => [hour, 0]);
  if (schedule === 'every-2-hours') return Array.from({ length: 12 }, (_, index) => [index * 2, 0]);
  if (schedule === 'every-4-hours') return Array.from({ length: 6 }, (_, index) => [index * 4, 0]);
  if (schedule === 'daily-1800' || schedule === 'weekdays-1800') return [[18, 0]];
  if (schedule === 'twice-daily') return [[9, 0], [18, 0]];
  if (schedule === 'weekly-friday-1730' || schedule === 'weekly-review') return [[17, 30]];
  if (schedule === 'monthly-last-1700') return [[17, 0]];
  return [[9, 0]];
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function zonedDateTimeToUtc(
  target: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
): Date {
  const targetEpoch = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0);
  let guess = targetEpoch;
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = fullLocalParts(new Date(guess), timezone);
    const actualEpoch = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += targetEpoch - actualEpoch;
  }
  return new Date(guess);
}

function fullLocalParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'), month: value('month'), day: value('day'),
    hour: value('hour'), minute: value('minute'), second: value('second'),
  };
}
