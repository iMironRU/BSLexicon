/**
 * Коллекции BSL: ссылочные типы `Массив`, `Структура`, `Соответствие`
 * и вспомогательный `КлючИЗначение` (результат обхода «Для Каждого»).
 *
 * Здесь же — реестр МЕТОДОВ под тем же инвариантом, что и функции: набор
 * `methodIds` обязан совпадать с записями `kind: method` в каталоге
 * (см. scripts/check-catalog.ts). И реестр конструкторов для оператора `Новый`.
 */
import { RuntimeError } from '../errors';
import { BslObject, UNDEFINED, displayValue, toBslString, toNumber, typeName } from './values';
import type { BslValue } from './values';

const MAX_SHOWN = 8;

/** Ячейка для краткого отображения вложенного значения. */
function cell(v: BslValue, depth: number): string {
  return displayValue(v, depth);
}

// ── Классы значений ──────────────────────────────────────────────

export class BslArray extends BslObject {
  readonly typeName = 'Массив';
  constructor(public items: BslValue[] = []) {
    super();
  }
  display(depth: number): string {
    if (depth >= 2) return `Массив (${this.items.length})`;
    const shown = this.items.slice(0, MAX_SHOWN).map((i) => cell(i, depth + 1));
    if (this.items.length > MAX_SHOWN) shown.push('…');
    return `Массив [${shown.join(', ')}]`;
  }
}

export class BslStructure extends BslObject {
  readonly typeName = 'Структура';
  /** ключ в нижнем регистре → исходное написание + значение (ключи регистронезависимы). */
  readonly props = new Map<string, { display: string; value: BslValue }>();
  display(depth: number): string {
    if (depth >= 2) return `Структура (${this.props.size})`;
    const shown = [...this.props.values()]
      .slice(0, MAX_SHOWN)
      .map(({ display, value }) => `${display}: ${cell(value, depth + 1)}`);
    if (this.props.size > MAX_SHOWN) shown.push('…');
    return `Структура {${shown.join('; ')}}`;
  }
}

export class BslMap extends BslObject {
  // Соответствие
  readonly typeName = 'Соответствие';
  readonly pairs: { key: BslValue; value: BslValue }[] = [];
  display(depth: number): string {
    if (depth >= 2) return `Соответствие (${this.pairs.length})`;
    const shown = this.pairs
      .slice(0, MAX_SHOWN)
      .map(({ key, value }) => `${cell(key, depth + 1)}: ${cell(value, depth + 1)}`);
    if (this.pairs.length > MAX_SHOWN) shown.push('…');
    return `Соответствие {${shown.join('; ')}}`;
  }
}

export class BslKeyValue extends BslObject {
  readonly typeName = 'КлючИЗначение';
  constructor(
    public readonly key: BslValue,
    public readonly value: BslValue,
  ) {
    super();
  }
  display(depth: number): string {
    return `${cell(this.key, depth + 1)}: ${cell(this.value, depth + 1)}`;
  }
}

// ── Доступ к членам / индексам / обход ───────────────────────────

export function getMember(obj: BslValue, name: string, line: number): BslValue {
  if (obj instanceof BslStructure) {
    const hit = obj.props.get(name.toLowerCase());
    if (!hit) throw new RuntimeError(`Структура: свойство «${name}» не найдено`, line);
    return hit.value;
  }
  if (obj instanceof BslKeyValue) {
    const key = name.toLowerCase();
    if (key === 'ключ' || key === 'key') return obj.key;
    if (key === 'значение' || key === 'value') return obj.value;
    throw new RuntimeError(`КлючИЗначение: нет свойства «${name}»`, line);
  }
  throw new RuntimeError(`Значение типа «${typeName(obj)}» не имеет свойства «${name}»`, line);
}

export function setMember(obj: BslValue, name: string, value: BslValue, line: number): void {
  if (obj instanceof BslStructure) {
    const hit = obj.props.get(name.toLowerCase());
    if (!hit) {
      throw new RuntimeError(
        `Структура: свойства «${name}» нет. Сначала добавьте его: Вставить("${name}", …)`,
        line,
      );
    }
    hit.value = value;
    return;
  }
  throw new RuntimeError(
    `Значению типа «${typeName(obj)}» нельзя присвоить свойство «${name}»`,
    line,
  );
}

export function getIndex(obj: BslValue, key: BslValue, line: number): BslValue {
  if (obj instanceof BslArray) return obj.items[arrayIndex(obj, key, line)];
  if (obj instanceof BslMap) {
    const hit = obj.pairs.find((p) => p.key === key);
    return hit ? hit.value : UNDEFINED;
  }
  throw new RuntimeError(
    `Значение типа «${typeName(obj)}» не поддерживает обращение по индексу [ ]`,
    line,
  );
}

export function setIndex(obj: BslValue, key: BslValue, value: BslValue, line: number): void {
  if (obj instanceof BslArray) {
    obj.items[arrayIndex(obj, key, line)] = value;
    return;
  }
  if (obj instanceof BslMap) {
    const hit = obj.pairs.find((p) => p.key === key);
    if (hit) hit.value = value;
    else obj.pairs.push({ key, value });
    return;
  }
  throw new RuntimeError(
    `Значение типа «${typeName(obj)}» не поддерживает присваивание по индексу [ ]`,
    line,
  );
}

export function iterate(obj: BslValue, line: number): BslValue[] {
  if (obj instanceof BslArray) return [...obj.items];
  if (obj instanceof BslMap) return obj.pairs.map((p) => new BslKeyValue(p.key, p.value));
  if (obj instanceof BslStructure) {
    return [...obj.props.values()].map((p) => new BslKeyValue(p.display, p.value));
  }
  throw new RuntimeError(`Значение типа «${typeName(obj)}» нельзя обойти «Для Каждого»`, line);
}

function arrayIndex(arr: BslArray, key: BslValue, line: number): number {
  const i = toNumber(key);
  if (!Number.isInteger(i) || i < 0 || i >= arr.items.length) {
    throw new RuntimeError(`Индекс ${i} за границами массива (размер ${arr.items.length})`, line);
  }
  return i;
}

// ── Реестр методов (под инвариантом рантайм↔каталог) ─────────────

interface MethodDef {
  name: string;
  aliases: string[];
  arity: [number, number];
  impl(self: BslObject, args: BslValue[], line: number): BslValue;
}

const ARRAY_METHODS: MethodDef[] = [
  {
    name: 'Добавить',
    aliases: ['add'],
    arity: [1, 1],
    impl: (self, args) => {
      (self as BslArray).items.push(args[0]);
      return UNDEFINED;
    },
  },
  {
    name: 'Количество',
    aliases: ['count'],
    arity: [0, 0],
    impl: (self) => (self as BslArray).items.length,
  },
  {
    name: 'Получить',
    aliases: ['get'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const a = self as BslArray;
      return a.items[arrayIndex(a, args[0], line)];
    },
  },
  {
    name: 'Установить',
    aliases: ['set'],
    arity: [2, 2],
    impl: (self, args, line) => {
      const a = self as BslArray;
      a.items[arrayIndex(a, args[0], line)] = args[1];
      return UNDEFINED;
    },
  },
  {
    name: 'Вставить',
    aliases: ['insert'],
    arity: [2, 2],
    impl: (self, args, line) => {
      const a = self as BslArray;
      const i = toNumber(args[0]);
      if (!Number.isInteger(i) || i < 0 || i > a.items.length) {
        throw new RuntimeError(`Вставить: индекс ${i} вне диапазона 0..${a.items.length}`, line);
      }
      a.items.splice(i, 0, args[1]);
      return UNDEFINED;
    },
  },
  {
    name: 'Удалить',
    aliases: ['delete'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const a = self as BslArray;
      a.items.splice(arrayIndex(a, args[0], line), 1);
      return UNDEFINED;
    },
  },
  {
    name: 'Найти',
    aliases: ['find'],
    arity: [1, 1],
    impl: (self, args) => {
      const i = (self as BslArray).items.indexOf(args[0]);
      return i >= 0 ? i : UNDEFINED;
    },
  },
  {
    name: 'Очистить',
    aliases: ['clear'],
    arity: [0, 0],
    impl: (self) => {
      (self as BslArray).items.length = 0;
      return UNDEFINED;
    },
  },
];

const STRUCT_METHODS: MethodDef[] = [
  {
    name: 'Вставить',
    aliases: ['insert'],
    arity: [2, 2],
    impl: (self, args) => {
      const key = toBslString(args[0]);
      (self as BslStructure).props.set(key.toLowerCase(), { display: key, value: args[1] });
      return UNDEFINED;
    },
  },
  {
    name: 'Свойство',
    aliases: ['property'],
    arity: [1, 1],
    // Подмножество: возвращает Булево «есть ли свойство» (без out-параметра 1С).
    impl: (self, args) => (self as BslStructure).props.has(toBslString(args[0]).toLowerCase()),
  },
  {
    name: 'Удалить',
    aliases: ['delete'],
    arity: [1, 1],
    impl: (self, args) => {
      (self as BslStructure).props.delete(toBslString(args[0]).toLowerCase());
      return UNDEFINED;
    },
  },
  {
    name: 'Количество',
    aliases: ['count'],
    arity: [0, 0],
    impl: (self) => (self as BslStructure).props.size,
  },
  {
    name: 'Очистить',
    aliases: ['clear'],
    arity: [0, 0],
    impl: (self) => {
      (self as BslStructure).props.clear();
      return UNDEFINED;
    },
  },
];

const MAP_METHODS: MethodDef[] = [
  {
    name: 'Вставить',
    aliases: ['insert'],
    arity: [2, 2],
    impl: (self, args, line) => {
      setIndex(self, args[0], args[1], line);
      return UNDEFINED;
    },
  },
  {
    name: 'Получить',
    aliases: ['get'],
    arity: [1, 1],
    impl: (self, args, line) => getIndex(self, args[0], line),
  },
  {
    name: 'Удалить',
    aliases: ['delete'],
    arity: [1, 1],
    impl: (self, args) => {
      const m = self as BslMap;
      const i = m.pairs.findIndex((p) => p.key === args[0]);
      if (i >= 0) m.pairs.splice(i, 1);
      return UNDEFINED;
    },
  },
  {
    name: 'Количество',
    aliases: ['count'],
    arity: [0, 0],
    impl: (self) => (self as BslMap).pairs.length,
  },
  {
    name: 'Очистить',
    aliases: ['clear'],
    arity: [0, 0],
    impl: (self) => {
      (self as BslMap).pairs.length = 0;
      return UNDEFINED;
    },
  },
];

const METHODS: Record<string, MethodDef[]> = {
  Массив: ARRAY_METHODS,
  Структура: STRUCT_METHODS,
  Соответствие: MAP_METHODS,
};

const METHOD_LOOKUP = new Map<string, MethodDef>();
for (const [type, defs] of Object.entries(METHODS)) {
  for (const d of defs) {
    METHOD_LOOKUP.set(`${type}::${d.name.toLowerCase()}`, d);
    for (const a of d.aliases) METHOD_LOOKUP.set(`${type}::${a}`, d);
  }
}

export function resolveMethod(type: string, method: string): MethodDef | undefined {
  return METHOD_LOOKUP.get(`${type}::${method.toLowerCase()}`);
}

/** Идентификаторы методов вида «Тип.Метод» — для инварианта рантайм↔каталог. */
export const methodIds: readonly string[] = Object.entries(METHODS).flatMap(([type, defs]) =>
  defs.map((d) => `${type}.${d.name}`),
);

// ── Конструкторы (оператор «Новый») ──────────────────────────────

interface ConstructorDef {
  type: string;
  aliases: string[];
  build(args: BslValue[]): BslObject;
}

const CONSTRUCTORS: ConstructorDef[] = [
  {
    type: 'Массив',
    aliases: ['массив', 'array'],
    build: (args) => {
      if (args.length === 0) return new BslArray();
      const size = Math.max(0, Math.trunc(toNumber(args[0])));
      return new BslArray(Array.from({ length: size }, () => UNDEFINED as BslValue));
    },
  },
  {
    type: 'Структура',
    aliases: ['структура', 'structure'],
    build: (args) => {
      const s = new BslStructure();
      if (args.length > 0 && typeof args[0] === 'string') {
        const keys = args[0].split(',').map((k) => k.trim()).filter(Boolean);
        keys.forEach((key, i) => {
          s.props.set(key.toLowerCase(), { display: key, value: args[i + 1] ?? UNDEFINED });
        });
      }
      return s;
    },
  },
  {
    type: 'Соответствие',
    aliases: ['соответствие', 'map'],
    build: () => new BslMap(),
  },
];

const CONSTRUCTOR_LOOKUP = new Map<string, ConstructorDef>();
for (const c of CONSTRUCTORS) for (const a of c.aliases) CONSTRUCTOR_LOOKUP.set(a, c);

export function resolveConstructor(type: string): ConstructorDef | undefined {
  return CONSTRUCTOR_LOOKUP.get(type.toLowerCase());
}
