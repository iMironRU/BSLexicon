import { RuntimeError } from '../errors';
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
import { UNDEFINED, toBslString, toNumber, typeName } from './values';
import type { BslValue } from './values';

/** Требует Дату; иначе — ошибка рантайма (у дат-функций один аргумент-дата). */
function asDate(value: BslValue, fn: string): BslDate {
  if (value instanceof BslDate) return value;
  throw new RuntimeError(`«${fn}»: ожидалась Дата, получено «${typeName(value)}»`);
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
];

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
