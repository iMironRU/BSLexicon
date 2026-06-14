import { UNDEFINED, toBslString, toNumber, typeName } from './values';
import type { BslValue } from './values';

/** Контекст исполнения, доступный встроенной функции (вывод и т.п.). */
export interface BuiltinContext {
  print(text: string): void;
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
