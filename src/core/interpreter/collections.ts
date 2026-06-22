/**
 * Коллекции BSL: ссылочные типы `Массив`, `Структура`, `Соответствие`
 * и вспомогательный `КлючИЗначение` (результат обхода «Для Каждого»).
 *
 * Здесь же — реестр МЕТОДОВ под тем же инвариантом, что и функции: набор
 * `methodIds` обязан совпадать с записями `kind: method` в каталоге
 * (см. scripts/check-catalog.ts). И реестр конструкторов для оператора `Новый`.
 */
import { RuntimeError } from '../errors';
import {
  BslObject,
  UNDEFINED,
  compareValues,
  copyValue,
  displayValue,
  isTruthy,
  toBslString,
  toNumber,
  typeName,
  valuesEqual,
} from './values';
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
  copy(seen: Map<BslObject, BslObject>): BslArray {
    const out = new BslArray();
    seen.set(this, out); // до рекурсии — на случай цикла
    for (const item of this.items) out.items.push(copyValue(item, seen));
    return out;
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
  copy(seen: Map<BslObject, BslObject>): BslStructure {
    const out = new BslStructure();
    seen.set(this, out);
    for (const [key, { display, value }] of this.props) {
      out.props.set(key, { display, value: copyValue(value, seen) });
    }
    return out;
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
  copy(seen: Map<BslObject, BslObject>): BslMap {
    const out = new BslMap();
    seen.set(this, out);
    for (const { key, value } of this.pairs) {
      out.pairs.push({ key: copyValue(key, seen), value: copyValue(value, seen) });
    }
    return out;
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
  copy(seen: Map<BslObject, BslObject>): BslKeyValue {
    return new BslKeyValue(copyValue(this.key, seen), copyValue(this.value, seen));
  }
}

/** Элемент списка значений: значение + представление + пометка (всё изменяемо). */
export class BslValueListItem extends BslObject {
  readonly typeName = 'ЭлементСпискаЗначений';
  constructor(
    public value: BslValue,
    public presentation: string = '',
    public check: boolean = false,
  ) {
    super();
  }
  display(depth: number): string {
    return this.presentation !== '' ? this.presentation : cell(this.value, depth);
  }
  copy(seen: Map<BslObject, BslObject>): BslValueListItem {
    const out = new BslValueListItem(UNDEFINED, this.presentation, this.check);
    seen.set(this, out);
    out.value = copyValue(this.value, seen);
    return out;
  }
}

export class BslValueList extends BslObject {
  readonly typeName = 'СписокЗначений';
  readonly items: BslValueListItem[] = [];
  display(depth: number): string {
    if (depth >= 2) return `СписокЗначений (${this.items.length})`;
    const shown = this.items.slice(0, MAX_SHOWN).map((i) => i.display(depth + 1));
    if (this.items.length > MAX_SHOWN) shown.push('…');
    return `СписокЗначений [${shown.join(', ')}]`;
  }
  copy(seen: Map<BslObject, BslObject>): BslValueList {
    const out = new BslValueList();
    seen.set(this, out);
    for (const item of this.items) out.items.push(copyValue(item, seen) as BslValueListItem);
    return out;
  }
}

// ── ТаблицаЗначений: колонки, строки, ячейки ──────────────────────

/** Колонка таблицы значений: имя + заголовок (изменяемы); знает свою таблицу. */
export class BslColumn extends BslObject {
  readonly typeName = 'КолонкаТаблицыЗначений';
  owner: BslValueTable | null = null;
  constructor(
    public name: string,
    public title: string,
  ) {
    super();
  }
  display(): string {
    return this.name;
  }
  copy(): BslColumn {
    return new BslColumn(this.name, this.title);
  }
}

/** Коллекция колонок таблицы значений. Изменения колонок синхронно меняют строки. */
export class BslColumnCollection extends BslObject {
  readonly typeName = 'КоллекцияКолонокТаблицыЗначений';
  readonly items: BslColumn[] = [];
  constructor(public owner: BslValueTable) {
    super();
  }
  display(): string {
    return `Колонки [${this.items.map((c) => c.name).join(', ')}]`;
  }
  copy(seen: Map<BslObject, BslObject>): BslColumnCollection {
    // Редкий случай — копия коллекции колонок отдельно от таблицы.
    const t = new BslValueTable();
    seen.set(this, t.columns);
    for (const c of this.items) t.addColumn(c.name, c.title);
    return t.columns;
  }
}

/** Строка таблицы значений: ячейки по имени колонки (в нижнем регистре). */
export class BslValueTableRow extends BslObject {
  readonly typeName = 'СтрокаТаблицыЗначений';
  readonly cells = new Map<string, BslValue>();
  constructor(public owner: BslValueTable) {
    super();
  }
  display(depth: number): string {
    const parts = this.owner.columns.items.map(
      (c) => `${c.name}: ${cell(this.cells.get(c.name.toLowerCase()) ?? UNDEFINED, depth + 1)}`,
    );
    return `Строка{${parts.join('; ')}}`;
  }
  copy(seen: Map<BslObject, BslObject>): BslValueTableRow {
    const t = new BslValueTable();
    for (const c of this.owner.columns.items) t.addColumn(c.name, c.title);
    const r = new BslValueTableRow(t);
    seen.set(this, r);
    for (const [k, v] of this.cells) r.cells.set(k, copyValue(v, seen));
    t.rows.push(r);
    return r;
  }
}

export class BslValueTable extends BslObject {
  readonly typeName = 'ТаблицаЗначений';
  readonly columns: BslColumnCollection;
  readonly rows: BslValueTableRow[] = [];
  constructor() {
    super();
    this.columns = new BslColumnCollection(this);
  }
  display(depth: number): string {
    const size = `${this.rows.length}×${this.columns.items.length}`;
    if (depth >= 2) return `ТаблицаЗначений (${size})`;
    return `ТаблицаЗначений ${size} [${this.columns.items.map((c) => c.name).join(', ')}]`;
  }
  copy(seen: Map<BslObject, BslObject>): BslValueTable {
    const t = new BslValueTable();
    seen.set(this, t);
    for (const c of this.columns.items) t.addColumn(c.name, c.title);
    for (const row of this.rows) {
      const r = new BslValueTableRow(t);
      for (const [k, v] of row.cells) r.cells.set(k, copyValue(v, seen));
      t.rows.push(r);
    }
    return t;
  }

  /** Добавляет колонку и ячейку в каждую существующую строку. */
  addColumn(name: string, title: string): BslColumn {
    const col = new BslColumn(name, title);
    col.owner = this;
    this.columns.items.push(col);
    for (const row of this.rows) row.cells.set(name.toLowerCase(), UNDEFINED);
    return col;
  }

  /** Добавляет пустую строку (ячейки по текущим колонкам). */
  addRow(): BslValueTableRow {
    const row = new BslValueTableRow(this);
    for (const c of this.columns.items) row.cells.set(c.name.toLowerCase(), UNDEFINED);
    this.rows.push(row);
    return row;
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
  if (obj instanceof BslValueListItem) {
    const key = name.toLowerCase();
    if (key === 'значение' || key === 'value') return obj.value;
    if (key === 'представление' || key === 'presentation') return obj.presentation;
    if (key === 'пометка' || key === 'check') return obj.check;
    throw new RuntimeError(`ЭлементСпискаЗначений: нет свойства «${name}»`, line);
  }
  if (obj instanceof BslValueTable) {
    const key = name.toLowerCase();
    if (key === 'колонки' || key === 'columns') return obj.columns;
    throw new RuntimeError(`ТаблицаЗначений: нет свойства «${name}»`, line);
  }
  if (obj instanceof BslColumn) {
    const key = name.toLowerCase();
    if (key === 'имя' || key === 'name') return obj.name;
    if (key === 'заголовок' || key === 'title') return obj.title;
    throw new RuntimeError(`КолонкаТаблицыЗначений: нет свойства «${name}»`, line);
  }
  if (obj instanceof BslValueTableRow) {
    const key = name.toLowerCase();
    if (obj.cells.has(key)) return obj.cells.get(key) as BslValue;
    throw new RuntimeError(`СтрокаТаблицыЗначений: нет колонки «${name}»`, line);
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
  if (obj instanceof BslValueListItem) {
    const key = name.toLowerCase();
    if (key === 'значение' || key === 'value') {
      obj.value = value;
      return;
    }
    if (key === 'представление' || key === 'presentation') {
      obj.presentation = toBslString(value);
      return;
    }
    if (key === 'пометка' || key === 'check') {
      obj.check = isTruthy(value);
      return;
    }
    throw new RuntimeError(`ЭлементСпискаЗначений: нет свойства «${name}»`, line);
  }
  if (obj instanceof BslColumn) {
    const key = name.toLowerCase();
    if (key === 'имя' || key === 'name') {
      renameColumn(obj, toBslString(value));
      return;
    }
    if (key === 'заголовок' || key === 'title') {
      obj.title = toBslString(value);
      return;
    }
    throw new RuntimeError(`КолонкаТаблицыЗначений: нет свойства «${name}»`, line);
  }
  if (obj instanceof BslValueTableRow) {
    const key = name.toLowerCase();
    if (obj.cells.has(key)) {
      obj.cells.set(key, value);
      return;
    }
    throw new RuntimeError(`СтрокаТаблицыЗначений: нет колонки «${name}»`, line);
  }
  throw new RuntimeError(
    `Значению типа «${typeName(obj)}» нельзя присвоить свойство «${name}»`,
    line,
  );
}

/** Переименование колонки: меняет имя и перевешивает ячейки во всех строках таблицы. */
function renameColumn(col: BslColumn, newName: string): void {
  const oldKey = col.name.toLowerCase();
  const newKey = newName.toLowerCase();
  if (oldKey !== newKey && col.owner) {
    for (const row of col.owner.rows) {
      if (row.cells.has(oldKey)) {
        row.cells.set(newKey, row.cells.get(oldKey) as BslValue);
        row.cells.delete(oldKey);
      }
    }
  }
  col.name = newName;
}

export function getIndex(obj: BslValue, key: BslValue, line: number): BslValue {
  if (obj instanceof BslArray) return obj.items[arrayIndex(obj, key, line)];
  if (obj instanceof BslValueList) return obj.items[listIndex(obj, key, line)];
  if (obj instanceof BslMap) {
    const hit = obj.pairs.find((p) => valuesEqual(p.key, key));
    return hit ? hit.value : UNDEFINED;
  }
  if (obj instanceof BslValueTable) {
    const i = toNumber(key);
    if (!Number.isInteger(i) || i < 0 || i >= obj.rows.length) {
      throw new RuntimeError(`Индекс строки ${i} за границами (строк ${obj.rows.length})`, line);
    }
    return obj.rows[i];
  }
  if (obj instanceof BslColumnCollection) {
    const col = findColumn(obj, key, line);
    return col;
  }
  if (obj instanceof BslValueTableRow) {
    return obj.cells.get(rowCellKey(obj, key, line)) as BslValue;
  }
  throw new RuntimeError(
    `Значение типа «${typeName(obj)}» не поддерживает обращение по индексу [ ]`,
    line,
  );
}

/** Колонка по индексу (Число) или имени (Строка). */
function findColumn(coll: BslColumnCollection, key: BslValue, line: number): BslColumn {
  if (typeof key === 'string') {
    const col = coll.items.find((c) => c.name.toLowerCase() === key.toLowerCase());
    if (!col) throw new RuntimeError(`Колонка «${key}» не найдена`, line);
    return col;
  }
  const i = toNumber(key);
  if (!Number.isInteger(i) || i < 0 || i >= coll.items.length) {
    throw new RuntimeError(`Индекс колонки ${i} за границами (колонок ${coll.items.length})`, line);
  }
  return coll.items[i];
}

/** Ключ ячейки строки по индексу колонки (Число) или имени колонки (Строка). */
function rowCellKey(row: BslValueTableRow, key: BslValue, line: number): string {
  if (typeof key === 'string') {
    const k = key.toLowerCase();
    if (!row.cells.has(k)) throw new RuntimeError(`СтрокаТаблицыЗначений: нет колонки «${key}»`, line);
    return k;
  }
  const i = toNumber(key);
  const col = row.owner.columns.items[i];
  if (!Number.isInteger(i) || i < 0 || !col) {
    throw new RuntimeError(`Колонка с индексом ${i} не найдена`, line);
  }
  return col.name.toLowerCase();
}

export function setIndex(obj: BslValue, key: BslValue, value: BslValue, line: number): void {
  if (obj instanceof BslArray) {
    obj.items[arrayIndex(obj, key, line)] = value;
    return;
  }
  if (obj instanceof BslMap) {
    const hit = obj.pairs.find((p) => valuesEqual(p.key, key));
    if (hit) hit.value = value;
    else obj.pairs.push({ key, value });
    return;
  }
  if (obj instanceof BslValueTableRow) {
    obj.cells.set(rowCellKey(obj, key, line), value);
    return;
  }
  throw new RuntimeError(
    `Значение типа «${typeName(obj)}» не поддерживает присваивание по индексу [ ]`,
    line,
  );
}

export function iterate(obj: BslValue, line: number): BslValue[] {
  if (obj instanceof BslArray) return [...obj.items];
  if (obj instanceof BslValueList) return [...obj.items];
  if (obj instanceof BslMap) return obj.pairs.map((p) => new BslKeyValue(p.key, p.value));
  if (obj instanceof BslStructure) {
    return [...obj.props.values()].map((p) => new BslKeyValue(p.display, p.value));
  }
  if (obj instanceof BslValueTable) return [...obj.rows];
  if (obj instanceof BslColumnCollection) return [...obj.items];
  throw new RuntimeError(`Значение типа «${typeName(obj)}» нельзя обойти «Для Каждого»`, line);
}

function arrayIndex(arr: BslArray, key: BslValue, line: number): number {
  const i = toNumber(key);
  if (!Number.isInteger(i) || i < 0 || i >= arr.items.length) {
    throw new RuntimeError(`Индекс ${i} за границами массива (размер ${arr.items.length})`, line);
  }
  return i;
}

function listIndex(list: BslValueList, key: BslValue, line: number): number {
  const i = toNumber(key);
  if (!Number.isInteger(i) || i < 0 || i >= list.items.length) {
    throw new RuntimeError(
      `Индекс ${i} за границами списка значений (размер ${list.items.length})`,
      line,
    );
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
      const i = m.pairs.findIndex((p) => valuesEqual(p.key, args[0]));
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

const VALUELIST_METHODS: MethodDef[] = [
  {
    name: 'Добавить',
    aliases: ['add'],
    arity: [1, 3],
    impl: (self, args) => {
      const list = self as BslValueList;
      const presentation = args.length > 1 ? toBslString(args[1]) : '';
      const check = args.length > 2 ? isTruthy(args[2]) : false;
      const item = new BslValueListItem(args[0], presentation, check);
      list.items.push(item);
      return item;
    },
  },
  {
    name: 'Количество',
    aliases: ['count'],
    arity: [0, 0],
    impl: (self) => (self as BslValueList).items.length,
  },
  {
    name: 'Получить',
    aliases: ['get'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const list = self as BslValueList;
      return list.items[listIndex(list, args[0], line)];
    },
  },
  {
    name: 'Вставить',
    aliases: ['insert'],
    arity: [2, 4],
    impl: (self, args, line) => {
      const list = self as BslValueList;
      const i = toNumber(args[0]);
      if (!Number.isInteger(i) || i < 0 || i > list.items.length) {
        throw new RuntimeError(`Вставить: индекс ${i} вне диапазона 0..${list.items.length}`, line);
      }
      const presentation = args.length > 2 ? toBslString(args[2]) : '';
      const check = args.length > 3 ? isTruthy(args[3]) : false;
      const item = new BslValueListItem(args[1], presentation, check);
      list.items.splice(i, 0, item);
      return item;
    },
  },
  {
    name: 'Удалить',
    aliases: ['delete'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const list = self as BslValueList;
      if (args[0] instanceof BslValueListItem) {
        const i = list.items.indexOf(args[0]);
        if (i >= 0) list.items.splice(i, 1);
      } else {
        list.items.splice(listIndex(list, args[0], line), 1);
      }
      return UNDEFINED;
    },
  },
  {
    name: 'Очистить',
    aliases: ['clear'],
    arity: [0, 0],
    impl: (self) => {
      (self as BslValueList).items.length = 0;
      return UNDEFINED;
    },
  },
  {
    name: 'НайтиПоЗначению',
    aliases: ['findbyvalue'],
    arity: [1, 1],
    impl: (self, args) => {
      const hit = (self as BslValueList).items.find((it) => valuesEqual(it.value, args[0]));
      return hit ?? UNDEFINED;
    },
  },
  {
    name: 'Индекс',
    aliases: ['indexof'],
    arity: [1, 1],
    impl: (self, args) => {
      const list = self as BslValueList;
      return args[0] instanceof BslValueListItem ? list.items.indexOf(args[0]) : -1;
    },
  },
  {
    name: 'ВыгрузитьЗначения',
    aliases: ['unloadvalues'],
    arity: [0, 0],
    impl: (self) => new BslArray((self as BslValueList).items.map((it) => it.value)),
  },
  {
    name: 'ЗагрузитьЗначения',
    aliases: ['loadvalues'],
    arity: [1, 1],
    impl: (self, args, line) => {
      if (!(args[0] instanceof BslArray)) {
        throw new RuntimeError(`ЗагрузитьЗначения: ожидался Массив, получено «${typeName(args[0])}»`, line);
      }
      const list = self as BslValueList;
      list.items.length = 0;
      for (const v of (args[0] as BslArray).items) list.items.push(new BslValueListItem(v));
      return UNDEFINED;
    },
  },
  {
    name: 'ЗаполнитьПометки',
    aliases: ['fillchecks'],
    arity: [1, 1],
    impl: (self, args) => {
      const flag = isTruthy(args[0]);
      for (const it of (self as BslValueList).items) it.check = flag;
      return UNDEFINED;
    },
  },
  {
    name: 'Сдвинуть',
    aliases: ['move'],
    arity: [2, 2],
    impl: (self, args, line) => {
      const list = self as BslValueList;
      const idx = args[0] instanceof BslValueListItem
        ? list.items.indexOf(args[0])
        : listIndex(list, args[0], line);
      if (idx < 0) throw new RuntimeError(`Сдвинуть: элемент не найден`, line);
      const newIdx = Math.max(0, Math.min(list.items.length - 1, idx + Math.trunc(toNumber(args[1]))));
      const [item] = list.items.splice(idx, 1);
      list.items.splice(newIdx, 0, item);
      return UNDEFINED;
    },
  },
  {
    name: 'Скопировать',
    aliases: ['copy'],
    arity: [0, 0],
    impl: (self) => {
      const out = new BslValueList();
      for (const it of (self as BslValueList).items) {
        out.items.push(new BslValueListItem(it.value, it.presentation, it.check));
      }
      return out;
    },
  },
  {
    name: 'СортироватьПоЗначению',
    aliases: ['sortbyvalue'],
    arity: [0, 1],
    impl: (self, args) => {
      const list = self as BslValueList;
      const desc = args.length > 0 && (toNumber(args[0]) === 1 || /^уб/i.test(toBslString(args[0])));
      list.items.sort((a, b) => (compareValues(a.value, b.value) ?? 0) * (desc ? -1 : 1));
      return UNDEFINED;
    },
  },
  {
    name: 'СортироватьПоПредставлению',
    aliases: ['sortbypresentation'],
    arity: [0, 1],
    impl: (self, args) => {
      const list = self as BslValueList;
      const desc = args.length > 0 && (toNumber(args[0]) === 1 || /^уб/i.test(toBslString(args[0])));
      list.items.sort((a, b) => {
        const pa = a.presentation !== '' ? a.presentation : toBslString(a.value);
        const pb = b.presentation !== '' ? b.presentation : toBslString(b.value);
        return pa.localeCompare(pb) * (desc ? -1 : 1);
      });
      return UNDEFINED;
    },
  },
];

const VALUETABLE_METHODS: MethodDef[] = [
  {
    name: 'Добавить',
    aliases: ['add'],
    arity: [0, 0],
    impl: (self) => (self as BslValueTable).addRow(),
  },
  {
    name: 'Количество',
    aliases: ['count'],
    arity: [0, 0],
    impl: (self) => (self as BslValueTable).rows.length,
  },
  {
    name: 'Получить',
    aliases: ['get'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const t = self as BslValueTable;
      const i = toNumber(args[0]);
      if (!Number.isInteger(i) || i < 0 || i >= t.rows.length) {
        throw new RuntimeError(`Индекс строки ${i} за границами (строк ${t.rows.length})`, line);
      }
      return t.rows[i];
    },
  },
  {
    name: 'Удалить',
    aliases: ['delete'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const t = self as BslValueTable;
      const idx = args[0] instanceof BslValueTableRow ? t.rows.indexOf(args[0]) : toNumber(args[0]);
      if (idx < 0 || idx >= t.rows.length) {
        throw new RuntimeError('Строка для удаления не найдена', line);
      }
      t.rows.splice(idx, 1);
      return UNDEFINED;
    },
  },
  {
    name: 'Очистить',
    aliases: ['clear'],
    arity: [0, 0],
    impl: (self) => {
      (self as BslValueTable).rows.length = 0;
      return UNDEFINED;
    },
  },
  {
    name: 'Итог',
    aliases: ['total'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const t = self as BslValueTable;
      const key = columnKey(t, args[0], 'Итог', line);
      let sum = 0;
      for (const row of t.rows) sum += toNumber(row.cells.get(key) ?? 0);
      return sum;
    },
  },
  {
    name: 'НайтиСтроки',
    aliases: ['findrows'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const t = self as BslValueTable;
      const filter = args[0];
      if (!(filter instanceof BslStructure)) {
        throw new RuntimeError('НайтиСтроки: ожидалась Структура отбора (Колонка = Значение)', line);
      }
      // Ключи Структуры уже в нижнем регистре — как и ключи ячеек строки.
      const conds: { key: string; value: BslValue }[] = [...filter.props.entries()].map(
        ([key, p]) => ({ key, value: p.value }),
      );
      const found = new BslArray();
      for (const row of t.rows) {
        const match = conds.every((c) => {
          const cellVal: BslValue = row.cells.get(c.key) ?? UNDEFINED;
          return valuesEqual(cellVal, c.value);
        });
        if (match) found.items.push(row);
      }
      return found;
    },
  },
  {
    name: 'ВыгрузитьКолонку',
    aliases: ['unloadcolumn'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const t = self as BslValueTable;
      const key = columnKey(t, args[0], 'ВыгрузитьКолонку', line);
      return new BslArray(t.rows.map((row) => row.cells.get(key) ?? UNDEFINED));
    },
  },
  {
    name: 'Вставить',
    aliases: ['insert'],
    arity: [1, 1],
    impl: (self, args) => {
      const t = self as BslValueTable;
      const idx = Math.max(0, Math.min(toNumber(args[0]), t.rows.length));
      const row = new BslValueTableRow(t);
      for (const c of t.columns.items) row.cells.set(c.name.toLowerCase(), UNDEFINED);
      t.rows.splice(idx, 0, row);
      return row;
    },
  },
  {
    name: 'Индекс',
    aliases: ['indexof'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const t = self as BslValueTable;
      if (!(args[0] instanceof BslValueTableRow))
        throw new RuntimeError('Индекс: ожидалась строка ТаблицыЗначений', line);
      return t.rows.indexOf(args[0]);
    },
  },
  {
    name: 'Найти',
    aliases: ['find'],
    arity: [1, 2],
    impl: (self, args) => {
      const t = self as BslValueTable;
      const needle = args[0];
      const colsArg = args.length > 1 ? toBslString(args[1]).trim() : '';
      const keys = colsArg
        ? colsArg.split(',').map((s) => s.trim().toLowerCase())
        : t.columns.items.map((c) => c.name.toLowerCase());
      for (const row of t.rows) {
        for (const k of keys) {
          if (valuesEqual(row.cells.get(k) ?? UNDEFINED, needle)) return row;
        }
      }
      return UNDEFINED;
    },
  },
  {
    name: 'Сдвинуть',
    aliases: ['move'],
    arity: [2, 2],
    impl: (self, args, line) => {
      const t = self as BslValueTable;
      if (!(args[0] instanceof BslValueTableRow))
        throw new RuntimeError('Сдвинуть: ожидалась строка ТаблицыЗначений', line);
      const from = t.rows.indexOf(args[0]);
      if (from === -1) throw new RuntimeError('Сдвинуть: строка не принадлежит таблице', line);
      const to = Math.max(0, Math.min(from + toNumber(args[1]), t.rows.length - 1));
      t.rows.splice(from, 1);
      t.rows.splice(to, 0, args[0] as BslValueTableRow);
      return UNDEFINED;
    },
  },
  {
    name: 'Скопировать',
    aliases: ['copy'],
    arity: [0, 2],
    impl: (self, args) => {
      const t = self as BslValueTable;
      const rowFilter =
        args.length > 0 && args[0] instanceof BslArray
          ? (args[0].items.filter((r) => r instanceof BslValueTableRow) as BslValueTableRow[])
          : null;
      const colArg = args.length > 1 && typeof args[1] === 'string' ? args[1].trim() : '';
      const colKeys = colArg
        ? colArg.split(',').map((s) => s.trim().toLowerCase())
        : null;
      const out = new BslValueTable();
      const cols = colKeys
        ? t.columns.items.filter((c) => colKeys.includes(c.name.toLowerCase()))
        : t.columns.items;
      for (const c of cols) out.addColumn(c.name, c.title);
      for (const row of rowFilter ?? t.rows) {
        const nr = out.addRow();
        for (const c of out.columns.items) nr.cells.set(c.name.toLowerCase(), row.cells.get(c.name.toLowerCase()) ?? UNDEFINED);
      }
      return out;
    },
  },
  {
    name: 'СкопироватьКолонки',
    aliases: ['copycolumns'],
    arity: [0, 1],
    impl: (self, args) => {
      const t = self as BslValueTable;
      const colArg = args.length > 0 && typeof args[0] === 'string' ? args[0].trim() : '';
      const colKeys = colArg ? colArg.split(',').map((s) => s.trim().toLowerCase()) : null;
      const out = new BslValueTable();
      const cols = colKeys
        ? t.columns.items.filter((c) => colKeys.includes(c.name.toLowerCase()))
        : t.columns.items;
      for (const c of cols) out.addColumn(c.name, c.title);
      return out;
    },
  },
  {
    name: 'Сортировать',
    aliases: ['sort'],
    arity: [1, 1],
    impl: (self, args) => {
      const t = self as BslValueTable;
      const criteria = toBslString(args[0])
        .split(',')
        .map((s) => {
          const parts = s.trim().split(/\s+/);
          const key = parts[0].toLowerCase();
          const desc = parts[1]?.toLowerCase() === 'убыв' || parts[1]?.toLowerCase() === 'desc';
          return { key, desc };
        });
      t.rows.sort((a, b) => {
        for (const { key, desc } of criteria) {
          const va = a.cells.get(key) ?? UNDEFINED;
          const vb = b.cells.get(key) ?? UNDEFINED;
          const cmp = compareValues(va, vb) ?? 0;
          if (cmp !== 0) return desc ? -cmp : cmp;
        }
        return 0;
      });
      return UNDEFINED;
    },
  },
  {
    name: 'ЗагрузитьКолонку',
    aliases: ['loadcolumn'],
    arity: [2, 2],
    impl: (self, args, line) => {
      const t = self as BslValueTable;
      if (!(args[0] instanceof BslArray))
        throw new RuntimeError('ЗагрузитьКолонку: первый аргумент должен быть Массивом', line);
      const key = columnKey(t, args[1], 'ЗагрузитьКолонку', line);
      const arr = args[0] as BslArray;
      const count = Math.min(arr.items.length, t.rows.length);
      for (let i = 0; i < count; i++) t.rows[i].cells.set(key, arr.items[i]);
      return UNDEFINED;
    },
  },
  {
    name: 'ЗаполнитьЗначения',
    aliases: ['fillvalues'],
    arity: [1, 2],
    impl: (self, args) => {
      const t = self as BslValueTable;
      const value = args[0];
      const colArg = args.length > 1 && typeof args[1] === 'string' ? args[1].trim() : '';
      const keys = colArg
        ? colArg.split(',').map((s) => s.trim().toLowerCase())
        : t.columns.items.map((c) => c.name.toLowerCase());
      for (const row of t.rows) {
        for (const k of keys) row.cells.set(k, value);
      }
      return UNDEFINED;
    },
  },
  {
    name: 'Свернуть',
    aliases: ['groupby'],
    arity: [1, 2],
    impl: (self, args) => {
      const t = self as BslValueTable;
      const groupKeys = toBslString(args[0])
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const sumKeys =
        args.length > 1
          ? toBslString(args[1]).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
          : [];
      const order: string[] = [];
      const groups = new Map<string, { row: BslValueTableRow; sums: Map<string, number> }>();
      for (const row of t.rows) {
        const gk = groupKeys.map((k) => JSON.stringify(row.cells.get(k) ?? null)).join('\x00');
        if (!groups.has(gk)) {
          order.push(gk);
          const nr = new BslValueTableRow(t);
          for (const c of t.columns.items) nr.cells.set(c.name.toLowerCase(), UNDEFINED);
          for (const k of groupKeys) nr.cells.set(k, row.cells.get(k) ?? UNDEFINED);
          groups.set(gk, { row: nr, sums: new Map(sumKeys.map((k) => [k, 0])) });
        }
        const g = groups.get(gk)!;
        for (const k of sumKeys) g.sums.set(k, (g.sums.get(k) ?? 0) + toNumber(row.cells.get(k) ?? 0));
      }
      t.rows.length = 0;
      for (const gk of order) {
        const { row, sums } = groups.get(gk)!;
        for (const [k, v] of sums) row.cells.set(k, v);
        t.rows.push(row);
      }
      return UNDEFINED;
    },
  },
];

const COLUMNS_METHODS: MethodDef[] = [
  {
    name: 'Добавить',
    aliases: ['add'],
    arity: [1, 3],
    // Добавить(Имя, [Тип], [Заголовок]). Тип не моделируем; Заголовок по умолчанию = Имя.
    impl: (self, args) => {
      const coll = self as BslColumnCollection;
      const name = toBslString(args[0]);
      const title = args.length > 2 ? toBslString(args[2]) : name;
      return coll.owner.addColumn(name, title);
    },
  },
  {
    name: 'Количество',
    aliases: ['count'],
    arity: [0, 0],
    impl: (self) => (self as BslColumnCollection).items.length,
  },
  {
    name: 'Получить',
    aliases: ['get'],
    arity: [1, 1],
    impl: (self, args, line) => findColumn(self as BslColumnCollection, toNumber(args[0]), line),
  },
  {
    name: 'Удалить',
    aliases: ['delete'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const coll = self as BslColumnCollection;
      let idx: number;
      if (args[0] instanceof BslColumn) idx = coll.items.indexOf(args[0]);
      else if (typeof args[0] === 'string') {
        const lower = args[0].toLowerCase();
        idx = coll.items.findIndex((c) => c.name.toLowerCase() === lower);
      } else idx = toNumber(args[0]);
      if (idx < 0 || idx >= coll.items.length) {
        throw new RuntimeError('Колонка для удаления не найдена', line);
      }
      const removed = coll.items.splice(idx, 1)[0];
      for (const row of coll.owner.rows) row.cells.delete(removed.name.toLowerCase());
      return UNDEFINED;
    },
  },
  {
    name: 'Вставить',
    aliases: ['insert'],
    arity: [2, 4],
    // Вставить(Индекс, Имя, Тип?, Заголовок?) — Тип не моделируем.
    impl: (self, args) => {
      const coll = self as BslColumnCollection;
      const idx = Math.max(0, Math.min(toNumber(args[0]), coll.items.length));
      const name = toBslString(args[1]);
      const title = args.length > 3 ? toBslString(args[3]) : name;
      const col = new BslColumn(name, title);
      col.owner = coll.owner;
      coll.items.splice(idx, 0, col);
      for (const row of coll.owner.rows) row.cells.set(name.toLowerCase(), UNDEFINED);
      return col;
    },
  },
  {
    name: 'Индекс',
    aliases: ['indexof'],
    arity: [1, 1],
    impl: (self, args, line) => {
      const coll = self as BslColumnCollection;
      if (!(args[0] instanceof BslColumn))
        throw new RuntimeError('Индекс: ожидалась колонка КоллекцияКолонок', line);
      return coll.items.indexOf(args[0]);
    },
  },
  {
    name: 'Найти',
    aliases: ['find'],
    arity: [1, 1],
    impl: (self, args) => {
      const coll = self as BslColumnCollection;
      const lower = toBslString(args[0]).toLowerCase();
      return coll.items.find((c) => c.name.toLowerCase() === lower) ?? UNDEFINED;
    },
  },
  {
    name: 'Очистить',
    aliases: ['clear'],
    arity: [0, 0],
    impl: (self) => {
      const coll = self as BslColumnCollection;
      coll.items.length = 0;
      for (const row of coll.owner.rows) row.cells.clear();
      return UNDEFINED;
    },
  },
  {
    name: 'Сдвинуть',
    aliases: ['move'],
    arity: [2, 2],
    impl: (self, args, line) => {
      const coll = self as BslColumnCollection;
      if (!(args[0] instanceof BslColumn))
        throw new RuntimeError('Сдвинуть: ожидалась колонка КоллекцияКолонок', line);
      const from = coll.items.indexOf(args[0]);
      if (from === -1) throw new RuntimeError('Сдвинуть: колонка не принадлежит коллекции', line);
      const to = Math.max(0, Math.min(from + toNumber(args[1]), coll.items.length - 1));
      coll.items.splice(from, 1);
      coll.items.splice(to, 0, args[0] as BslColumn);
      return UNDEFINED;
    },
  },
];

/** Имя колонки (ключ ячеек) с проверкой существования. */
function columnKey(table: BslValueTable, name: BslValue, fn: string, line: number): string {
  const key = toBslString(name).toLowerCase();
  if (!table.columns.items.some((c) => c.name.toLowerCase() === key)) {
    throw new RuntimeError(`«${fn}»: колонка «${toBslString(name)}» не найдена`, line);
  }
  return key;
}

const METHODS: Record<string, MethodDef[]> = {
  Массив: ARRAY_METHODS,
  Структура: STRUCT_METHODS,
  Соответствие: MAP_METHODS,
  СписокЗначений: VALUELIST_METHODS,
  ТаблицаЗначений: VALUETABLE_METHODS,
  КоллекцияКолонокТаблицыЗначений: COLUMNS_METHODS,
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

/**
 * Идентификаторы свойств вида «Тип.Свойство» — для инварианта рантайм↔каталог.
 * Свойства реально обслуживает `getMember`/`setMember` (см. выше); этот список
 * перечисляет то, что зарегистрировано в каталоге как `kind: property`.
 */
export const propertyIds: readonly string[] = [
  'КлючИЗначение.Ключ',
  'КлючИЗначение.Значение',
  'ЭлементСпискаЗначений.Значение',
  'ЭлементСпискаЗначений.Представление',
  'ЭлементСпискаЗначений.Пометка',
  'ТаблицаЗначений.Колонки',
  'КолонкаТаблицыЗначений.Имя',
  'КолонкаТаблицыЗначений.Заголовок',
];

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
  {
    type: 'СписокЗначений',
    aliases: ['списокзначений', 'valuelist'],
    build: () => new BslValueList(),
  },
  {
    type: 'ТаблицаЗначений',
    aliases: ['таблицазначений', 'valuetable'],
    build: () => new BslValueTable(),
  },
];

const CONSTRUCTOR_LOOKUP = new Map<string, ConstructorDef>();
for (const c of CONSTRUCTORS) for (const a of c.aliases) CONSTRUCTOR_LOOKUP.set(a, c);

export function resolveConstructor(type: string): ConstructorDef | undefined {
  return CONSTRUCTOR_LOOKUP.get(type.toLowerCase());
}
