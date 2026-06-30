'use client';

import { CalendarClock, Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type StudioAutomationSchedule } from '@/lib/studio-automations';

type ScheduleGroup = 'manual' | 'daily' | 'weekly' | 'monthly' | 'interval';

interface AutomationScheduleCopy {
  scheduleLabel: string;
  repeatGroupManual: string;
  repeatGroupDaily: string;
  repeatGroupWeekly: string;
  repeatGroupMonthly: string;
  repeatGroupInterval: string;
  manual: string;
  hourly: string;
  every2Hours: string;
  every4Hours: string;
  daily: string;
  dailyEvening: string;
  twiceDaily: string;
  weekdays: string;
  weekdaysEvening: string;
  weeklyMonday: string;
  weeklyFriday: string;
  weekly: string;
  monthlyFirst: string;
  monthlyLast: string;
  manualHint: string;
  hourlyHint: string;
  every2HoursHint: string;
  every4HoursHint: string;
  dailyHint: string;
  dailyEveningHint: string;
  twiceDailyHint: string;
  weekdaysHint: string;
  weekdaysEveningHint: string;
  weeklyMondayHint: string;
  weeklyFridayHint: string;
  weeklyHint: string;
  monthlyFirstHint: string;
  monthlyLastHint: string;
}

const SCHEDULE_GROUPS: ScheduleGroup[] = ['manual', 'daily', 'weekly', 'monthly', 'interval'];
const SCHEDULE_OPTIONS_BY_GROUP: Record<ScheduleGroup, StudioAutomationSchedule[]> = {
  manual: ['manual'],
  daily: ['daily-0900', 'daily-1800', 'twice-daily', 'weekdays-0900', 'weekdays-1800'],
  weekly: ['weekly-monday-0900', 'weekly-friday-1730', 'weekly-review'],
  monthly: ['monthly-first-0900', 'monthly-last-1700'],
  interval: ['hourly', 'every-2-hours', 'every-4-hours'],
};

export function scheduleLabel(schedule: StudioAutomationSchedule, copy: AutomationScheduleCopy): string {
  if (schedule === 'manual') return copy.manual;
  if (schedule === 'hourly') return copy.hourly;
  if (schedule === 'every-2-hours') return copy.every2Hours;
  if (schedule === 'every-4-hours') return copy.every4Hours;
  if (schedule === 'daily-0900') return copy.daily;
  if (schedule === 'daily-1800') return copy.dailyEvening;
  if (schedule === 'twice-daily') return copy.twiceDaily;
  if (schedule === 'weekdays-0900') return copy.weekdays;
  if (schedule === 'weekdays-1800') return copy.weekdaysEvening;
  if (schedule === 'weekly-monday-0900') return copy.weeklyMonday;
  if (schedule === 'weekly-friday-1730') return copy.weeklyFriday;
  if (schedule === 'weekly-review') return copy.weekly;
  if (schedule === 'monthly-first-0900') return copy.monthlyFirst;
  return copy.monthlyLast;
}

function scheduleDescription(schedule: StudioAutomationSchedule, copy: AutomationScheduleCopy): string {
  if (schedule === 'manual') return copy.manualHint;
  if (schedule === 'hourly') return copy.hourlyHint;
  if (schedule === 'every-2-hours') return copy.every2HoursHint;
  if (schedule === 'every-4-hours') return copy.every4HoursHint;
  if (schedule === 'daily-0900') return copy.dailyHint;
  if (schedule === 'daily-1800') return copy.dailyEveningHint;
  if (schedule === 'twice-daily') return copy.twiceDailyHint;
  if (schedule === 'weekdays-0900') return copy.weekdaysHint;
  if (schedule === 'weekdays-1800') return copy.weekdaysEveningHint;
  if (schedule === 'weekly-monday-0900') return copy.weeklyMondayHint;
  if (schedule === 'weekly-friday-1730') return copy.weeklyFridayHint;
  if (schedule === 'weekly-review') return copy.weeklyHint;
  if (schedule === 'monthly-first-0900') return copy.monthlyFirstHint;
  return copy.monthlyLastHint;
}

function scheduleGroup(schedule: StudioAutomationSchedule): ScheduleGroup {
  if (schedule === 'manual') return 'manual';
  if (schedule === 'hourly' || schedule === 'every-2-hours' || schedule === 'every-4-hours') return 'interval';
  if (schedule === 'weekly-monday-0900' || schedule === 'weekly-friday-1730' || schedule === 'weekly-review') return 'weekly';
  if (schedule === 'monthly-first-0900' || schedule === 'monthly-last-1700') return 'monthly';
  return 'daily';
}

function scheduleGroupLabel(group: ScheduleGroup, copy: AutomationScheduleCopy): string {
  if (group === 'manual') return copy.repeatGroupManual;
  if (group === 'daily') return copy.repeatGroupDaily;
  if (group === 'weekly') return copy.repeatGroupWeekly;
  if (group === 'monthly') return copy.repeatGroupMonthly;
  return copy.repeatGroupInterval;
}

export function StudioAutomationSchedulePicker({
  copy,
  value,
  onChange,
}: {
  copy: AutomationScheduleCopy;
  value: StudioAutomationSchedule;
  onChange: (schedule: StudioAutomationSchedule) => void;
}) {
  const [activeGroup, setActiveGroup] = useState<ScheduleGroup>(() => scheduleGroup(value));

  useEffect(() => {
    setActiveGroup(scheduleGroup(value));
  }, [value]);

  const selectGroup = (group: ScheduleGroup) => {
    setActiveGroup(group);
    if (!SCHEDULE_OPTIONS_BY_GROUP[group].includes(value)) {
      onChange(SCHEDULE_OPTIONS_BY_GROUP[group][0]);
    }
  };

  return (
    <section
      data-studio-automation-repeat-picker
      className="grid gap-2.5 rounded-lg border border-border/60 bg-background/40 p-3"
      aria-label={copy.scheduleLabel}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <CalendarClock size={13} className="shrink-0 text-[var(--amber)]" aria-hidden="true" />
          {copy.scheduleLabel}
        </span>
        <span className="min-w-0 truncate rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 py-1 text-[11px] font-medium text-[var(--amber-text)]">
          {scheduleLabel(value, copy)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex min-w-full rounded-md border border-border/60 bg-muted/25 p-0.5">
          {SCHEDULE_GROUPS.map((group) => {
            const selected = activeGroup === group;
            return (
              <button
                key={group}
                type="button"
                aria-pressed={selected}
                onClick={() => selectGroup(group)}
                className={`h-7 flex-1 whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? 'bg-[var(--amber-subtle)] text-[var(--amber-text)]'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
              >
                {scheduleGroupLabel(group, copy)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-1.5">
        {SCHEDULE_OPTIONS_BY_GROUP[activeGroup].map((schedule) => {
          const selected = value === schedule;
          return (
            <button
              key={schedule}
              data-studio-automation-repeat-option={schedule}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(schedule)}
              className={`grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected
                  ? 'border-[var(--amber)]/40 bg-[var(--amber-subtle)] text-foreground'
                  : 'border-border/60 bg-background/65 text-muted-foreground hover:border-[var(--amber)]/35 hover:bg-background hover:text-foreground'
              }`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                selected
                  ? 'border-[var(--amber)] bg-[var(--amber)] text-[var(--amber-foreground)]'
                  : 'border-border/70 bg-muted/35 text-transparent'
              }`}>
                <Clock3 size={11} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{scheduleLabel(schedule, copy)}</span>
                <span className="block truncate text-[11px] leading-relaxed text-muted-foreground">
                  {scheduleDescription(schedule, copy)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
