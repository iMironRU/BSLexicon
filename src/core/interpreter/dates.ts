/**
 * Тип «Дата» BSL — ЗНАЧИМЫЙ (в отличие от коллекций): неизменяемый, сравнивается
 * по значению. Поэтому это НЕ наследник `BslObject` (у того ссылочная семантика).
 *
 * Внутри — момент времени в миллисекундах, построенный через `Date.UTC`, чтобы
 * не зависеть от часового пояса хоста (1С-дата часового пояса не имеет).
 */
export class BslDate {
  constructor(public readonly time: number) {}
}

/** Момент по компонентам (месяц — человеческий, 1..12). */
export function makeDateTime(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Формат как у 1С (ru): «ДД.ММ.ГГГГ Ч:ММ:СС» (час без ведущего нуля). */
export function formatDate(date: BslDate): string {
  const dt = new Date(date.time);
  return (
    `${pad2(dt.getUTCDate())}.${pad2(dt.getUTCMonth() + 1)}.${dt.getUTCFullYear()} ` +
    `${dt.getUTCHours()}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`
  );
}

export const dateYear = (d: BslDate): number => new Date(d.time).getUTCFullYear();
export const dateMonth = (d: BslDate): number => new Date(d.time).getUTCMonth() + 1;
export const dateDay = (d: BslDate): number => new Date(d.time).getUTCDate();
export const dateHour = (d: BslDate): number => new Date(d.time).getUTCHours();
export const dateMinute = (d: BslDate): number => new Date(d.time).getUTCMinutes();
export const dateSecond = (d: BslDate): number => new Date(d.time).getUTCSeconds();

/** Начало суток (00:00:00) той же даты. */
export function startOfDay(d: BslDate): BslDate {
  return new BslDate(makeDateTime(dateYear(d), dateMonth(d), dateDay(d)));
}

/** Конец суток (23:59:59) той же даты. */
export function endOfDay(d: BslDate): BslDate {
  return new BslDate(makeDateTime(dateYear(d), dateMonth(d), dateDay(d), 23, 59, 59));
}

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Прибавить N месяцев; день обрезается до последнего в целевом месяце (как в 1С). */
export function addMonths(d: BslDate, n: number): BslDate {
  const total = dateYear(d) * 12 + (dateMonth(d) - 1) + Math.trunc(n);
  const ny = Math.floor(total / 12);
  const nmo = (total % 12) + 1;
  const day = Math.min(dateDay(d), daysInMonth(ny, nmo));
  return new BslDate(makeDateTime(ny, nmo, day, dateHour(d), dateMinute(d), dateSecond(d)));
}

export function startOfMonth(d: BslDate): BslDate {
  return new BslDate(makeDateTime(dateYear(d), dateMonth(d), 1));
}
export function endOfMonth(d: BslDate): BslDate {
  const y = dateYear(d), mo = dateMonth(d);
  return new BslDate(makeDateTime(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate(), 23, 59, 59));
}

export function startOfYear(d: BslDate): BslDate {
  return new BslDate(makeDateTime(dateYear(d), 1, 1));
}
export function endOfYear(d: BslDate): BslDate {
  return new BslDate(makeDateTime(dateYear(d), 12, 31, 23, 59, 59));
}

export function startOfWeek(d: BslDate): BslDate {
  const dow = (new Date(d.time).getUTCDay() + 6) % 7; // 0=Пн
  const ms = d.time - dow * 86400000;
  const dt = new Date(ms);
  return new BslDate(makeDateTime(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
}
export function endOfWeek(d: BslDate): BslDate {
  const dow = (new Date(d.time).getUTCDay() + 6) % 7;
  const ms = d.time + (6 - dow) * 86400000;
  const dt = new Date(ms);
  return new BslDate(makeDateTime(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), 23, 59, 59));
}

export function startOfQuarter(d: BslDate): BslDate {
  const mo = dateMonth(d);
  const firstMo = mo - ((mo - 1) % 3);
  return new BslDate(makeDateTime(dateYear(d), firstMo, 1));
}
export function endOfQuarter(d: BslDate): BslDate {
  const mo = dateMonth(d);
  const lastMo = mo + (2 - (mo - 1) % 3);
  const y = dateYear(d);
  return new BslDate(makeDateTime(y, lastMo, new Date(Date.UTC(y, lastMo, 0)).getUTCDate(), 23, 59, 59));
}

export function startOfHour(d: BslDate): BslDate {
  return new BslDate(makeDateTime(dateYear(d), dateMonth(d), dateDay(d), dateHour(d)));
}
export function endOfHour(d: BslDate): BslDate {
  return new BslDate(makeDateTime(dateYear(d), dateMonth(d), dateDay(d), dateHour(d), 59, 59));
}

export function startOfMinute(d: BslDate): BslDate {
  return new BslDate(makeDateTime(dateYear(d), dateMonth(d), dateDay(d), dateHour(d), dateMinute(d)));
}
export function endOfMinute(d: BslDate): BslDate {
  return new BslDate(makeDateTime(dateYear(d), dateMonth(d), dateDay(d), dateHour(d), dateMinute(d), 59));
}

export function dayOfYear(d: BslDate): number {
  const y = dateYear(d);
  return Math.round((d.time - Date.UTC(y, 0, 1)) / 86400000) + 1;
}

/** 1=Понедельник … 7=Воскресенье (как в 1С). */
export function dayOfWeek(d: BslDate): number {
  return (new Date(d.time).getUTCDay() + 6) % 7 + 1;
}

/** Номер недели по ISO 8601 (неделя, содержащая 4 января — первая). */
export function weekOfYear(d: BslDate): number {
  const jan4 = (y: number): number => {
    const dt = new Date(Date.UTC(y, 0, 4));
    return dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86400000; // начало нед-1
  };
  const y = dateYear(d);
  const w1 = jan4(y);
  if (d.time < w1) return weekOfYear(new BslDate(Date.UTC(y - 1, 11, 31)));
  const w1next = jan4(y + 1);
  if (d.time >= w1next) return 1;
  return Math.floor((d.time - w1) / (7 * 86400000)) + 1;
}

/** Текущая дата-время как «наивная» (локальные компоненты хоста, без часового пояса). */
export function nowDate(): BslDate {
  const n = new Date();
  return new BslDate(
    makeDateTime(
      n.getFullYear(),
      n.getMonth() + 1,
      n.getDate(),
      n.getHours(),
      n.getMinutes(),
      n.getSeconds(),
    ),
  );
}
