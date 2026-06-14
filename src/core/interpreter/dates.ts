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
