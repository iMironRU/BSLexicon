import { RuntimeError } from '../errors';
import { BslArray } from './collections';
import {
  BslDate,
  addMonths,
  dateDay,
  dateHour,
  dateMinute,
  dateMonth,
  dateSecond,
  dateYear,
  endOfDay,
  makeDateTime,
  nowDate,
  startOfDay,
} from './dates';
import { UNDEFINED, compareValues, isTruthy, toBslString, toNumber, typeName } from './values';
import type { BslValue } from './values';

/** Требует Дату; иначе — ошибка рантайма (у дат-функций один аргумент-дата). */
function asDate(value: BslValue, fn: string): BslDate {
  if (value instanceof BslDate) return value;
  throw new RuntimeError(`«${fn}»: ожидалась Дата, получено «${typeName(value)}»`);
}

/** Экранирует символы для использования внутри класса регулярного выражения [ ]. */
function escapeForCharClass(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/** Контекст исполнения, доступный встроенной функции (вывод, текущая ошибка). */
export interface BuiltinContext {
  print(text: string): void;
  /** Описание ошибки, пойманной текущим блоком «Исключение» (иначе пустая строка). */
  errorDescription(): string;
}

export interface Builtin {
  /** Канонический идентификатор (= id записи в каталоге языка). */
  id: string;
  /** Альтернативные написания в нижнем регистре (англ. имя и пр.). */
  aliases: string[];
  /** Минимум и максимум количества аргументов. */
  arity: [number, number];
  impl(args: BslValue[], ctx: BuiltinContext): BslValue;
}

/**
 * Реестр встроенных функций — то, что реально исполняется.
 * ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ: набор `id` здесь обязан совпадать с записями
 * `kind: function` в каталоге языка (`catalog/`). Расхождение ловит
 * `npm run check:catalog` и роняет сборку (см. docs/concept.md §5.3).
 */
export const BUILTINS: readonly Builtin[] = [
  {
    id: 'Сообщить',
    aliases: ['message'],
    arity: [1, 1],
    impl: (args, ctx) => {
      ctx.print(toBslString(args[0]));
      return UNDEFINED;
    },
  },
  {
    id: 'Строка',
    aliases: ['string'],
    arity: [1, 1],
    impl: (args) => toBslString(args[0]),
  },
  {
    id: 'Число',
    aliases: ['number'],
    arity: [1, 1],
    impl: (args) => toNumber(args[0]),
  },
  {
    id: 'СокрЛП',
    aliases: ['trimall'],
    arity: [1, 1],
    impl: (args) => toBslString(args[0]).trim(),
  },
  {
    id: 'ВРег',
    aliases: ['upper'],
    arity: [1, 1],
    impl: (args) => toBslString(args[0]).toUpperCase(),
  },
  {
    id: 'НРег',
    aliases: ['lower'],
    arity: [1, 1],
    impl: (args) => toBslString(args[0]).toLowerCase(),
  },
  {
    id: 'СтрДлина',
    aliases: ['strlen'],
    arity: [1, 1],
    impl: (args) => toBslString(args[0]).length,
  },
  {
    id: 'ТипЗнч',
    aliases: ['typeof'],
    arity: [1, 1],
    // Скелет: возвращаем имя типа строкой. В реальном BSL результат — объект `Тип`.
    impl: (args) => typeName(args[0]),
  },
  {
    id: 'ОписаниеОшибки',
    aliases: ['errordescription'],
    arity: [0, 0],
    // Текст ошибки, пойманной текущим «Исключение»; вне обработчика — пустая строка.
    impl: (_args, ctx) => ctx.errorDescription(),
  },

  // ── Даты ──────────────────────────────────────────────────────
  {
    id: 'Дата',
    aliases: ['date'],
    arity: [3, 6],
    // Дата(Год, Месяц, День[, Час, Минута, Секунда]). Строковая форма — литерал '…'.
    impl: (args) => {
      const at = (i: number): number => (i < args.length ? toNumber(args[i]) : 0);
      return new BslDate(makeDateTime(at(0), at(1), at(2), at(3), at(4), at(5)));
    },
  },
  {
    id: 'ТекущаяДата',
    aliases: ['currentdate'],
    arity: [0, 0],
    impl: () => nowDate(),
  },
  {
    id: 'Год',
    aliases: ['year'],
    arity: [1, 1],
    impl: (args) => dateYear(asDate(args[0], 'Год')),
  },
  {
    id: 'Месяц',
    aliases: ['month'],
    arity: [1, 1],
    impl: (args) => dateMonth(asDate(args[0], 'Месяц')),
  },
  {
    id: 'День',
    aliases: ['day'],
    arity: [1, 1],
    impl: (args) => dateDay(asDate(args[0], 'День')),
  },
  {
    id: 'Час',
    aliases: ['hour'],
    arity: [1, 1],
    impl: (args) => dateHour(asDate(args[0], 'Час')),
  },
  {
    id: 'Минута',
    aliases: ['minute'],
    arity: [1, 1],
    impl: (args) => dateMinute(asDate(args[0], 'Минута')),
  },
  {
    id: 'Секунда',
    aliases: ['second'],
    arity: [1, 1],
    impl: (args) => dateSecond(asDate(args[0], 'Секунда')),
  },
  {
    id: 'НачалоДня',
    aliases: ['begofday'],
    arity: [1, 1],
    impl: (args) => startOfDay(asDate(args[0], 'НачалоДня')),
  },
  {
    id: 'КонецДня',
    aliases: ['endofday'],
    arity: [1, 1],
    impl: (args) => endOfDay(asDate(args[0], 'КонецДня')),
  },
  {
    id: 'ДобавитьМесяц',
    aliases: ['addmonth'],
    arity: [2, 2],
    impl: (args) => addMonths(asDate(args[0], 'ДобавитьМесяц'), toNumber(args[1])),
  },

  // ── Строковые ─────────────────────────────────────────────────
  {
    id: 'СокрЛ',
    aliases: ['triml'],
    arity: [1, 1],
    impl: (args) => toBslString(args[0]).replace(/^\s+/, ''),
  },
  {
    id: 'СокрП',
    aliases: ['trimr'],
    arity: [1, 1],
    impl: (args) => toBslString(args[0]).replace(/\s+$/, ''),
  },
  {
    id: 'Лев',
    aliases: ['left'],
    arity: [2, 2],
    impl: (args) => {
      const n = Math.trunc(toNumber(args[1]));
      return n <= 0 ? '' : toBslString(args[0]).slice(0, n);
    },
  },
  {
    id: 'Прав',
    aliases: ['right'],
    arity: [2, 2],
    impl: (args) => {
      const s = toBslString(args[0]);
      const n = Math.trunc(toNumber(args[1]));
      return n <= 0 ? '' : s.slice(Math.max(0, s.length - n));
    },
  },
  {
    id: 'Сред',
    aliases: ['mid'],
    arity: [2, 3],
    impl: (args) => {
      const s = toBslString(args[0]);
      const start = Math.max(1, Math.trunc(toNumber(args[1]))) - 1; // НачальныйНомер с 1
      if (args.length > 2) {
        const count = Math.trunc(toNumber(args[2]));
        return count <= 0 ? '' : s.slice(start, start + count);
      }
      return s.slice(start);
    },
  },
  {
    id: 'СтрНайти',
    aliases: ['strfind'],
    arity: [2, 2],
    // Позиция первого вхождения с 1 (0 — не найдено). Направление/начало пока не поддержаны.
    impl: (args) => {
      const needle = toBslString(args[1]);
      if (needle === '') return 0;
      const i = toBslString(args[0]).indexOf(needle);
      return i < 0 ? 0 : i + 1;
    },
  },
  {
    id: 'СтрЗаменить',
    aliases: ['strreplace'],
    arity: [3, 3],
    impl: (args) => {
      const s = toBslString(args[0]);
      const find = toBslString(args[1]);
      return find === '' ? s : s.split(find).join(toBslString(args[2]));
    },
  },
  {
    id: 'СтрРазделить',
    aliases: ['strsplit'],
    arity: [2, 3],
    // Каждый символ Разделителя — отдельный разделитель (как в 1С).
    impl: (args) => {
      const s = toBslString(args[0]);
      const sep = toBslString(args[1]);
      const includeEmpty = args.length > 2 ? isTruthy(args[2]) : true;
      let parts = sep === '' ? [s] : s.split(new RegExp(`[${escapeForCharClass(sep)}]`));
      if (!includeEmpty) parts = parts.filter((p) => p !== '');
      return new BslArray(parts);
    },
  },
  {
    id: 'СтрСоединить',
    aliases: ['strconcat'],
    arity: [1, 2],
    impl: (args) => {
      const arr = args[0];
      if (!(arr instanceof BslArray)) {
        throw new RuntimeError(
          `«СтрСоединить»: первый аргумент должен быть Массивом, получено «${typeName(arr)}»`,
        );
      }
      const sep = args.length > 1 ? toBslString(args[1]) : '';
      return arr.items.map((v) => toBslString(v)).join(sep);
    },
  },
  {
    id: 'СтрЧислоСтрок',
    aliases: ['strlinecount'],
    arity: [1, 1],
    impl: (args) => toBslString(args[0]).split('\n').length,
  },
  {
    id: 'КодСимвола',
    aliases: ['charcode'],
    arity: [1, 1],
    impl: (args) => {
      const s = toBslString(args[0]);
      return s.length === 0 ? 0 : s.codePointAt(0) ?? 0;
    },
  },
  {
    id: 'Символ',
    aliases: ['char'],
    arity: [1, 1],
    impl: (args) => String.fromCodePoint(Math.trunc(toNumber(args[0]))),
  },
  {
    id: 'ПустаяСтрока',
    aliases: ['isblankstring'],
    arity: [1, 1],
    impl: (args) => toBslString(args[0]).trim() === '',
  },
  {
    id: 'СтрНачинаетсяС',
    aliases: ['strstartswith'],
    arity: [2, 2],
    impl: (args) => toBslString(args[0]).startsWith(toBslString(args[1])),
  },
  {
    id: 'СтрЗаканчиваетсяНа',
    aliases: ['strendswith'],
    arity: [2, 2],
    impl: (args) => toBslString(args[0]).endsWith(toBslString(args[1])),
  },
  {
    id: 'СтрСравнить',
    aliases: ['strcompare'],
    arity: [2, 2],
    impl: (args) => {
      const cmp = toBslString(args[0]).toLowerCase().localeCompare(toBslString(args[1]).toLowerCase());
      return cmp < 0 ? -1 : cmp > 0 ? 1 : 0;
    },
  },
  {
    id: 'СтрЧислоВхождений',
    aliases: ['stroccurrencecount'],
    arity: [2, 2],
    impl: (args) => {
      const s = toBslString(args[0]);
      const needle = toBslString(args[1]);
      if (needle === '') return 0;
      let count = 0;
      let pos = 0;
      while ((pos = s.indexOf(needle, pos)) !== -1) { count += 1; pos += needle.length; }
      return count;
    },
  },
  {
    id: 'СтрПолучитьСтроку',
    aliases: ['strgetline'],
    arity: [2, 2],
    impl: (args) => {
      const lines = toBslString(args[0]).split('\n');
      const n = Math.trunc(toNumber(args[1]));
      return n >= 1 && n <= lines.length ? lines[n - 1] : '';
    },
  },
  {
    id: 'ТРег',
    aliases: ['titlecase'],
    arity: [1, 1],
    impl: (args) => {
      const s = toBslString(args[0]);
      let prevWasLetter = false;
      return [...s].map((ch) => {
        const isLetter = /\p{L}/u.test(ch);
        const out = isLetter && !prevWasLetter ? ch.toUpperCase() : isLetter ? ch.toLowerCase() : ch;
        prevWasLetter = isLetter;
        return out;
      }).join('');
    },
  },

  // ── Числовые ──────────────────────────────────────────────────
  {
    id: 'Цел',
    aliases: ['int'],
    arity: [1, 1],
    impl: (args) => Math.trunc(toNumber(args[0])),
  },
  {
    id: 'Окр',
    aliases: ['round'],
    arity: [1, 3],
    // Округление до Разрядности (по умолчанию 0), .5 — от нуля. Режим пока не поддержан.
    impl: (args) => {
      const num = toNumber(args[0]);
      const digits = args.length > 1 ? Math.trunc(toNumber(args[1])) : 0;
      const factor = 10 ** digits;
      return (Math.sign(num) * Math.round(Math.abs(num) * factor)) / factor;
    },
  },
  {
    id: 'Макс',
    aliases: ['max'],
    arity: [1, 255],
    impl: (args) => pickExtreme(args, 'Макс', 1),
  },
  {
    id: 'Мин',
    aliases: ['min'],
    arity: [1, 255],
    impl: (args) => pickExtreme(args, 'Мин', -1),
  },

  // ── Тригонометрия и экспоненты ────────────────────────────────
  {
    id: 'Sin',
    aliases: ['sin'],
    arity: [1, 1],
    impl: (args) => Math.sin(toNumber(args[0])),
  },
  {
    id: 'Cos',
    aliases: ['cos'],
    arity: [1, 1],
    impl: (args) => Math.cos(toNumber(args[0])),
  },
  {
    id: 'Tan',
    aliases: ['tan'],
    arity: [1, 1],
    impl: (args) => Math.tan(toNumber(args[0])),
  },
  {
    id: 'ASin',
    aliases: ['asin'],
    arity: [1, 1],
    impl: (args) => Math.asin(toNumber(args[0])),
  },
  {
    id: 'ACos',
    aliases: ['acos'],
    arity: [1, 1],
    impl: (args) => Math.acos(toNumber(args[0])),
  },
  {
    id: 'ATan',
    aliases: ['atan'],
    arity: [1, 1],
    impl: (args) => Math.atan(toNumber(args[0])),
  },
  {
    id: 'Exp',
    aliases: ['exp'],
    arity: [1, 1],
    impl: (args) => Math.exp(toNumber(args[0])),
  },
  {
    id: 'Log',
    aliases: ['log'],
    arity: [1, 1],
    impl: (args) => Math.log(toNumber(args[0])),
  },
  {
    id: 'Log10',
    aliases: ['log10'],
    arity: [1, 1],
    impl: (args) => Math.log10(toNumber(args[0])),
  },
  {
    id: 'Pow',
    aliases: ['pow'],
    arity: [2, 2],
    impl: (args) => Math.pow(toNumber(args[0]), toNumber(args[1])),
  },
  {
    id: 'Sqrt',
    aliases: ['sqrt'],
    arity: [1, 1],
    impl: (args) => Math.sqrt(toNumber(args[0])),
  },
];

/** Возвращает максимум (`dir=1`) или минимум (`dir=-1`) из аргументов. */
function pickExtreme(args: BslValue[], fn: string, dir: number): BslValue {
  let best = args[0];
  for (let i = 1; i < args.length; i += 1) {
    const c = compareValues(args[i], best);
    if (c === undefined) throw new RuntimeError(`«${fn}»: значения несравнимы`);
    if (Math.sign(c) === dir) best = args[i];
  }
  return best;
}

const LOOKUP = new Map<string, Builtin>();
for (const b of BUILTINS) {
  LOOKUP.set(b.id.toLowerCase(), b);
  for (const alias of b.aliases) LOOKUP.set(alias, b);
}

export function resolveBuiltin(name: string): Builtin | undefined {
  return LOOKUP.get(name.toLowerCase());
}

/** Канонические идентификаторы встроенных функций — для инварианта рантайм↔каталог. */
export const builtinIds: readonly string[] = BUILTINS.map((b) => b.id);
