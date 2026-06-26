const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function formatDate(date: Date, format: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: MONTHS[date.getMonth()] ?? '',
    MMM: MONTHS_SHORT[date.getMonth()] ?? '',
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    dddd: WEEKDAYS[date.getDay()] ?? '',
    ddd: WEEKDAYS_SHORT[date.getDay()] ?? '',
    dd: WEEKDAYS_MIN[date.getDay()] ?? '',
    d: String(date.getDay()),
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    mm: pad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds()),
    s: String(date.getSeconds()),
  };
  return format.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|dd|d|HH|H|mm|m|ss|s/g, (token) => tokens[token] ?? token);
}

let currentMomentLocale = 'en';
const momentLocaleConfigs = new Map<string, Record<string, unknown>>();

function normalizeMomentUnit(unit?: string): string {
  const raw = String(unit ?? '');
  if (raw === 'M') return 'month';
  if (raw === 'm') return 'minute';
  const normalized = raw.toLowerCase();
  if (['y', 'year', 'years'].includes(normalized)) return 'year';
  if (['q', 'quarter', 'quarters'].includes(normalized)) return 'quarter';
  if (['month', 'months'].includes(normalized)) return 'month';
  if (['w', 'week', 'weeks'].includes(normalized)) return 'week';
  if (['d', 'day', 'days', 'date'].includes(normalized)) return 'day';
  if (['h', 'hour', 'hours'].includes(normalized)) return 'hour';
  if (['minute', 'minutes'].includes(normalized)) return 'minute';
  if (['s', 'second', 'seconds'].includes(normalized)) return 'second';
  return normalized;
}

function currentMomentWeekStart(): number {
  const config = momentLocaleConfigs.get(currentMomentLocale) as { week?: { dow?: unknown } } | undefined;
  const dow = config?.week?.dow;
  return typeof dow === 'number' && Number.isFinite(dow) ? ((Math.trunc(dow) % 7) + 7) % 7 : 0;
}

function weekOfYear(date: Date): number {
  const first = new Date(date.getFullYear(), 0, 1);
  const firstWeekStart = new Date(first);
  const offset = (first.getDay() - currentMomentWeekStart() + 7) % 7;
  firstWeekStart.setDate(first.getDate() - offset);
  const diffMs = date.valueOf() - firstWeekStart.valueOf();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function orderedMomentNames(values: string[], ordered?: boolean): string[] {
  if (!ordered) return values;
  const start = currentMomentWeekStart();
  return [...values.slice(start), ...values.slice(0, start)];
}

function compareMomentDates(left: Date, right: Date, unit?: string): number {
  const normalized = normalizeMomentUnit(unit);
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (normalized) {
    startOfMomentUnit(leftDate, normalized);
    startOfMomentUnit(rightDate, normalized);
  }
  return leftDate.valueOf() - rightDate.valueOf();
}

function addMomentUnit(date: Date, amount: number, unit?: string): void {
  const normalized = normalizeMomentUnit(unit);
  if (!Number.isFinite(amount)) return;
  switch (normalized) {
    case 'year':
      date.setFullYear(date.getFullYear() + amount);
      break;
    case 'quarter':
      date.setMonth(date.getMonth() + amount * 3);
      break;
    case 'month':
      date.setMonth(date.getMonth() + amount);
      break;
    case 'week':
      date.setDate(date.getDate() + amount * 7);
      break;
    case 'day':
      date.setDate(date.getDate() + amount);
      break;
    case 'hour':
      date.setHours(date.getHours() + amount);
      break;
    case 'minute':
      date.setMinutes(date.getMinutes() + amount);
      break;
    case 'second':
      date.setSeconds(date.getSeconds() + amount);
      break;
  }
}

function startOfMomentUnit(date: Date, unit?: string): void {
  const normalized = normalizeMomentUnit(unit);
  if (normalized === 'year') {
    date.setMonth(0, 1);
    date.setHours(0, 0, 0, 0);
  } else if (normalized === 'quarter') {
    date.setMonth(Math.floor(date.getMonth() / 3) * 3, 1);
    date.setHours(0, 0, 0, 0);
  } else if (normalized === 'month') {
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
  } else if (normalized === 'week') {
    const offset = (date.getDay() - currentMomentWeekStart() + 7) % 7;
    date.setDate(date.getDate() - offset);
    date.setHours(0, 0, 0, 0);
  } else if (normalized === 'day') {
    date.setHours(0, 0, 0, 0);
  } else if (normalized === 'hour') {
    date.setMinutes(0, 0, 0);
  } else if (normalized === 'minute') {
    date.setSeconds(0, 0);
  } else if (normalized === 'second') {
    date.setMilliseconds(0);
  }
}

function getMomentUnit(date: Date, unit: string): number {
  const raw = unit.toLowerCase();
  if (raw === 'date' || raw === 'dates') return date.getDate();
  if (raw === 'day' || raw === 'days' || raw === 'd') return date.getDay();
  const normalized = normalizeMomentUnit(unit);
  if (normalized === 'year') return date.getFullYear();
  if (normalized === 'month') return date.getMonth();
  if (normalized === 'week') return weekOfYear(date);
  if (normalized === 'hour') return date.getHours();
  if (normalized === 'minute') return date.getMinutes();
  if (normalized === 'second') return date.getSeconds();
  if (unit === 'weekday') return (date.getDay() - currentMomentWeekStart() + 7) % 7;
  return Number.NaN;
}

function setMomentUnit(date: Date, unit: string, value: number): void {
  const raw = unit.toLowerCase();
  if (!Number.isFinite(value)) return;
  if (raw === 'date' || raw === 'dates') {
    date.setDate(value);
    return;
  }
  if (raw === 'day' || raw === 'days' || raw === 'd') {
    date.setDate(date.getDate() + (value - date.getDay()));
    return;
  }
  const normalized = normalizeMomentUnit(unit);
  if (normalized === 'year') date.setFullYear(value);
  else if (normalized === 'month') date.setMonth(value);
  else if (normalized === 'week') addMomentUnit(date, value - weekOfYear(date), 'week');
  else if (normalized === 'hour') date.setHours(value);
  else if (normalized === 'minute') date.setMinutes(value);
  else if (normalized === 'second') date.setSeconds(value);
  else if (unit === 'weekday') date.setDate(date.getDate() + (value - ((date.getDay() - currentMomentWeekStart() + 7) % 7)));
}

export function moment(input?: string | number | Date | { toDate?: () => Date; valueOf?: () => number }) {
  const date = input instanceof Date
    ? new Date(input)
    : input && typeof input === 'object' && typeof input.toDate === 'function'
      ? new Date(input.toDate())
      : input === undefined
        ? new Date()
        : new Date(input as string | number);

  const api = {
    clone: () => moment(date),
    format: (format = 'YYYY-MM-DDTHH:mm:ss') => formatDate(date, format),
    calendar: () => {
      const today = new Date();
      startOfMomentUnit(today, 'day');
      const target = new Date(date);
      startOfMomentUnit(target, 'day');
      const diffDays = Math.round((target.valueOf() - today.valueOf()) / (24 * 60 * 60 * 1000));
      if (diffDays === 0) return `Today at ${formatDate(date, 'HH:mm')}`;
      if (diffDays === 1) return `Tomorrow at ${formatDate(date, 'HH:mm')}`;
      if (diffDays === -1) return `Yesterday at ${formatDate(date, 'HH:mm')}`;
      return formatDate(date, 'YYYY-MM-DD');
    },
    toDate: () => new Date(date),
    valueOf: () => date.valueOf(),
    unix: () => Math.floor(date.valueOf() / 1000),
    isValid: () => !Number.isNaN(date.valueOf()),
    add: (amount: number, unit?: string) => {
      addMomentUnit(date, amount, unit);
      return api;
    },
    subtract: (amount: number, unit?: string) => {
      addMomentUnit(date, -amount, unit);
      return api;
    },
    startOf: (unit?: string) => {
      startOfMomentUnit(date, unit);
      return api;
    },
    endOf: (unit?: string) => {
      startOfMomentUnit(date, unit);
      addMomentUnit(date, 1, unit);
      date.setMilliseconds(date.getMilliseconds() - 1);
      return api;
    },
    get: (unit: string) => getMomentUnit(date, unit),
    set: (unitOrValues: string | Record<string, number>, value?: number) => {
      if (typeof unitOrValues === 'string') {
        setMomentUnit(date, unitOrValues, Number(value));
      } else {
        for (const [unit, nextValue] of Object.entries(unitOrValues)) {
          setMomentUnit(date, unit, Number(nextValue));
        }
      }
      return api;
    },
    date: (value?: number) => {
      if (value === undefined) return date.getDate();
      date.setDate(value);
      return api;
    },
    day: (value?: number) => {
      if (value === undefined) return date.getDay();
      date.setDate(date.getDate() + (value - date.getDay()));
      return api;
    },
    weekday: (value?: number) => {
      const weekday = (date.getDay() - currentMomentWeekStart() + 7) % 7;
      if (value === undefined) return weekday;
      date.setDate(date.getDate() + (value - weekday));
      return api;
    },
    isoWeekday: (value?: number) => {
      const isoDay = date.getDay() === 0 ? 7 : date.getDay();
      if (value === undefined) return isoDay;
      date.setDate(date.getDate() + (value - isoDay));
      return api;
    },
    month: (value?: number) => {
      if (value === undefined) return date.getMonth();
      date.setMonth(value);
      return api;
    },
    year: (value?: number) => {
      if (value === undefined) return date.getFullYear();
      date.setFullYear(value);
      return api;
    },
    week: (value?: number) => {
      if (value === undefined) return weekOfYear(date);
      addMomentUnit(date, value - weekOfYear(date), 'week');
      return api;
    },
    isSame: (other: unknown, unit?: string) => compareMomentDates(date, moment(other as string | number | Date).toDate(), unit) === 0,
    isBefore: (other: unknown, unit?: string) => compareMomentDates(date, moment(other as string | number | Date).toDate(), unit) < 0,
    isAfter: (other: unknown, unit?: string) => compareMomentDates(date, moment(other as string | number | Date).toDate(), unit) > 0,
    isSameOrBefore: (other: unknown, unit?: string) => compareMomentDates(date, moment(other as string | number | Date).toDate(), unit) <= 0,
    isSameOrAfter: (other: unknown, unit?: string) => compareMomentDates(date, moment(other as string | number | Date).toDate(), unit) >= 0,
    locale: (locale?: string) => {
      if (typeof locale === 'string' && locale.trim()) {
        moment.locale(locale);
        return api;
      }
      return moment.locale();
    },
    localeData: () => moment.localeData(),
  };
  return api;
}

moment.now = Date.now;
moment.utc = moment;
moment.unix = (seconds: number) => moment(seconds * 1000);
moment.locale = (locale?: string): string => {
  if (typeof locale === 'string' && locale.trim()) {
    currentMomentLocale = locale.trim();
  }
  return currentMomentLocale;
};
moment.updateLocale = (locale: string, config: Record<string, unknown> = {}): Record<string, unknown> => {
  const key = typeof locale === 'string' && locale.trim() ? locale.trim() : currentMomentLocale;
  const next = {
    ...(momentLocaleConfigs.get(key) ?? {}),
    ...config,
  };
  momentLocaleConfigs.set(key, next);
  currentMomentLocale = key;
  return next;
};
moment.weekdays = (ordered?: boolean) => orderedMomentNames(WEEKDAYS, ordered);
moment.weekdaysShort = (ordered?: boolean) => orderedMomentNames(WEEKDAYS_SHORT, ordered);
moment.weekdaysMin = (ordered?: boolean) => orderedMomentNames(WEEKDAYS_MIN, ordered);
moment.months = () => MONTHS;
moment.monthsShort = () => MONTHS_SHORT;
moment.localeData = () => ({
  _week: { dow: currentMomentWeekStart() },
  firstDayOfWeek: () => currentMomentWeekStart(),
  weekdays: () => WEEKDAYS,
  weekdaysShort: () => WEEKDAYS_SHORT,
  weekdaysMin: () => WEEKDAYS_MIN,
  months: () => MONTHS,
  monthsShort: () => MONTHS_SHORT,
  longDateFormat: (token: string) => ({
    L: 'YYYY-MM-DD',
    LL: 'MMMM D, YYYY',
    LLL: 'MMMM D, YYYY HH:mm',
    LLLL: 'dddd, MMMM D, YYYY HH:mm',
    LT: 'HH:mm',
    LTS: 'HH:mm:ss',
  })[token] ?? token,
});
