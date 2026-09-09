/**
 * Модель данных песочницы языка запросов 1С (#36).
 *
 * Схема (`*.schema.yaml`) описывает объекты метаданных: справочники,
 * документы, регистры накопления и сведений. Данные (`*.data.yaml`) —
 * записи под конкретную схему. Оба формата документированы в
 * `docs/query-sandbox/README.md` §4.2 и `docs/query-sandbox/schema-format.json`.
 *
 * Внутренняя модель — TypeScript-типы для валидированного YAML.
 * BslValue переиспользуем из core (single source of truth для типов 1С).
 */
import type { BslValue } from '@core/index';

// ── Типы полей ──────────────────────────────────────────────────────

/**
 * Формальное описание типа поля. Идиоматично для 1С: `Строка(9)`,
 * `Число(15,3)`. Парсим из строки в структуру.
 */
export type FieldType =
  | { kind: 'Строка'; length?: number }
  | { kind: 'Число'; digits?: number; fraction?: number }
  | { kind: 'Дата' }
  | { kind: 'Булево' }
  | { kind: 'УникальныйИдентификатор' }
  | { kind: 'Ссылка'; refs: string /* «Справочник.Номенклатура» */ };

// ── Поля и объекты ─────────────────────────────────────────────────

export interface Field {
  name: string;
  type: FieldType;
  /** Первичный ключ (для Ссылки объекта — автополе). */
  key?: boolean;
}

export interface TabularSection {
  name: string;
  fields: Field[];
}

/** Общая часть для Справочника и Документа. */
interface ObjectBase {
  name: string;
  fields: Field[];
  tabular?: TabularSection[];
}

export interface CatalogTable extends ObjectBase {
  kind: 'Справочник';
  /** Есть ли иерархия (автополе `Родитель`). */
  hierarchical?: boolean;
}

export interface DocumentTable extends ObjectBase {
  kind: 'Документ';
}

/**
 * Регистр накопления. `view` определяет какие виртуальные таблицы
 * доступны: `Остатки` → Остатки/Обороты/ОстаткиИОбороты + ВидДвижения,
 * `Обороты` → только Обороты.
 */
export interface AccumRegister {
  kind: 'РегистрНакопления';
  name: string;
  view: 'Остатки' | 'Обороты';
  dimensions: Field[];
  resources: Field[];
  attributes?: Field[];
}

/**
 * Регистр сведений. `periodic: true` → есть автополе `Период` и виртуальные
 * СрезПоследних/СрезПервых. `periodic: false` → просто key-value таблица.
 */
export interface InfoRegister {
  kind: 'РегистрСведений';
  name: string;
  periodic: boolean;
  dimensions: Field[];
  resources: Field[];
  attributes?: Field[];
}

export type Table = CatalogTable | DocumentTable | AccumRegister | InfoRegister;

export interface Schema {
  version: 1;
  tables: Table[];
}

// ── Данные ─────────────────────────────────────────────────────────

/**
 * Одна запись — плоский объект «имя поля → значение». Ссылки — по
 * короткому id (строка, обычно короткий человекочитаемый идентификатор
 * вроде `n1`, `d1`). Табличные части — массив вложенных записей.
 */
export type Record = { [field: string]: BslValue | Record[] };

/**
 * Данные: карта «полное имя таблицы → массив записей».
 *
 * Ключ формата `Справочник.Номенклатура`, `Документ.РасходнаяНакладная`,
 * `РегистрНакопления.ОстаткиТоваров`, `РегистрСведений.ЦеныНоменклатуры`.
 */
export interface Data {
  version: 1;
  records: { [tableRef: string]: Record[] };
}

/** Полный контекст песочницы: схема + данные. */
export interface Fixture {
  schema: Schema;
  data: Data;
}

/** Полное имя таблицы: `<kind>.<name>`. Для запросов и Data.records. */
export function tableRef(t: Table): string {
  return `${t.kind}.${t.name}`;
}
