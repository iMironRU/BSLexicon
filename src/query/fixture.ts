/**
 * Fixture — фаза «пре-runtime»: строим индексированный слепок из
 * пары `Schema + Data` для интерпретатора (#40).
 *
 * Что делаем:
 *   1. Для каждой таблицы храним `Row[]` (массив записей).
 *   2. Индекс по `Ссылка` → Row — для разыменования (`Х.Родитель.Наименование`).
 *   3. Знаем какие поля есть у таблицы (для алиасов и валидации).
 *
 * Row внутри — обычный объект `{ имя_поля: BslValue }`. Не делаем
 * специального класса — предельная простота, дешёвый round-trip
 * через плоский JS.
 */
import type { BslValue } from '@core/index';
import { NULL, UNDEFINED } from '@core/interpreter/values';
import type { Data, Field, Record, Schema, Table } from './types';

/** Одна запись — плоский объект «имя поля → значение 1С». */
export type Row = { [field: string]: BslValue | Row[] };

export interface TableFixture {
  table: Table;
  ref: string; // `Kind.Name`
  rows: Row[];
  /** Индекс по ключевому полю (обычно `Ссылка`) → Row. Пуст если нет ключа. */
  byRef: Map<string, Row>;
  /** Множество имён полей верхнего уровня (для быстрой валидации). */
  fieldNames: Set<string>;
}

export interface Fixture {
  schema: Schema;
  tables: Map<string, TableFixture>;
}

/**
 * Строит Fixture — предполагаем что `validateFixture(schema, data)`
 * уже прошёл (см. schema-loader).
 */
export function buildFixture(schema: Schema, data: Data): Fixture {
  const tables = new Map<string, TableFixture>();
  for (const table of schema.tables) {
    const ref = `${table.kind}.${table.name}`;
    const rawRows = data.records[ref] ?? [];
    const rows: Row[] = rawRows.map((r) => normalizeRow(r, table));
    const fieldNames = new Set<string>(fieldsOf(table).map((f) => f.name));

    const byRef = new Map<string, Row>();
    const keyField = keyOf(table);
    if (keyField) {
      for (const row of rows) {
        const key = row[keyField];
        if (typeof key === 'string' && key) byRef.set(key, row);
      }
    }
    tables.set(ref, { table, ref, rows, byRef, fieldNames });
  }
  return { schema, tables };
}

/**
 * Разыменование: значение-ссылка `id` в таблице `refs` (например
 * `Справочник.Номенклатура`) → Row или null (битая ссылка / null-ref).
 */
export function derefRef(fx: Fixture, refs: string, id: BslValue): Row | null {
  if (typeof id !== 'string' || !id) return null;
  const target = fx.tables.get(refs);
  if (!target) return null;
  return target.byRef.get(id) ?? null;
}

/** Все Row таблицы по короткому имени (`Справочник.Номенклатура`). */
export function rowsOf(fx: Fixture, tableRef: string): Row[] | null {
  return fx.tables.get(tableRef)?.rows ?? null;
}

/**
 * Приводит YAML-значение к BslValue: `null` в YAML — это NULL из 1С,
 * `undefined` (отсутствие ключа) — Неопределено. Остальное — как есть.
 * Без этого `ЕСТЬ NULL` не срабатывал бы над Родитель у групп.
 */
function normalizeValue(v: unknown): BslValue {
  if (v === null) return NULL;
  if (v === undefined) return UNDEFINED;
  return v as BslValue;
}

// ── helpers ────────────────────────────────────────────────────────

/**
 * Все top-level поля таблицы: сначала стандартные автополя (Ссылка,
 * ПометкаУдаления, для иерархических — Родитель/ЭтоГруппа, для документа —
 * Номер/Дата/Проведён, для регистров — Период/Регистратор). Потом —
 * поля, объявленные в схеме. Дубли решаются в пользу объявленного
 * (автор может переопределить тип).
 */
export function fieldsOf(table: Table): Field[] {
  return mergeFields(autoFieldsFor(table), declaredFieldsOf(table));
}

function declaredFieldsOf(table: Table): Field[] {
  switch (table.kind) {
    case 'Справочник':
    case 'Документ':
      return table.fields;
    case 'РегистрНакопления':
    case 'РегистрСведений':
      return [...table.dimensions, ...table.resources, ...(table.attributes ?? [])];
  }
}

/** Синтетические автополя, которые в 1С всегда есть — даже если автор их не объявил. */
function autoFieldsFor(table: Table): Field[] {
  switch (table.kind) {
    case 'Справочник': {
      const auto: Field[] = [
        { name: 'Ссылка', type: { kind: 'УникальныйИдентификатор' }, key: true },
        { name: 'Код', type: { kind: 'Строка' } },
        { name: 'Наименование', type: { kind: 'Строка' } },
        { name: 'ПометкаУдаления', type: { kind: 'Булево' } },
      ];
      if (table.hierarchical) {
        auto.push({ name: 'Родитель', type: { kind: 'Ссылка', refs: `Справочник.${table.name}` } });
        auto.push({ name: 'ЭтоГруппа', type: { kind: 'Булево' } });
      }
      return auto;
    }
    case 'Документ':
      return [
        { name: 'Ссылка', type: { kind: 'УникальныйИдентификатор' }, key: true },
        { name: 'Номер', type: { kind: 'Строка' } },
        { name: 'Дата', type: { kind: 'Дата' } },
        { name: 'ПометкаУдаления', type: { kind: 'Булево' } },
        { name: 'Проведён', type: { kind: 'Булево' } },
      ];
    case 'РегистрНакопления':
      return [
        { name: 'Период', type: { kind: 'Дата' } },
        { name: 'Регистратор', type: { kind: 'Строка' } },
        ...(table.view === 'Остатки'
          ? [{ name: 'ВидДвижения', type: { kind: 'Строка' } as const }]
          : []),
      ];
    case 'РегистрСведений':
      return [
        ...(table.periodic ? [{ name: 'Период', type: { kind: 'Дата' } as const }] : []),
        { name: 'Регистратор', type: { kind: 'Строка' } },
      ];
  }
}

function mergeFields(auto: Field[], declared: Field[]): Field[] {
  const byName = new Map<string, Field>();
  for (const f of auto) byName.set(f.name, f);
  // Объявленные перезаписывают автополя одноимённые.
  for (const f of declared) byName.set(f.name, f);
  return [...byName.values()];
}

/** Имя ключевого поля (для быстрого byRef-индекса). */
function keyOf(table: Table): string | null {
  const fs = fieldsOf(table);
  return fs.find((f) => f.key)?.name ?? null;
}

/**
 * Заполняет отсутствующие поля значением по умолчанию (Undefined),
 * копирует табличные части как массивы Row.
 *
 * Для регистров сохраняем системные автополя (`Период`, `Регистратор`,
 * `ВидДвижения` для регистра остатков) — они в схеме явно не описаны,
 * но нужны и виртуальным таблицам, и учебным запросам.
 */
function normalizeRow(raw: Record, table: Table): Row {
  const out: Row = {};
  for (const f of fieldsOf(table)) {
    out[f.name] = normalizeValue(raw[f.name]);
  }
  // Табличные части — только у Справочника и Документа.
  if (table.kind === 'Справочник' || table.kind === 'Документ') {
    for (const ts of table.tabular ?? []) {
      const rawTs = raw[ts.name];
      if (Array.isArray(rawTs)) {
        // Каждая строка табличной части — свой набор полей.
        const rows: Row[] = rawTs.map((r) => {
          const rr: Row = {};
          for (const f of ts.fields) {
            rr[f.name] = normalizeValue((r as Record)[f.name]);
          }
          return rr;
        });
        out[ts.name] = rows;
      } else {
        out[ts.name] = [];
      }
    }
  }
  return out;
}
