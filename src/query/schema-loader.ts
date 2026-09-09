/**
 * Парсер и валидатор `.schema.yaml` / `.data.yaml` для песочницы
 * языка запросов (#36). Возвращает discriminated union `{ok,error}` —
 * никогда не бросает наружу, чтобы UI мог показать педагогу понятную
 * ошибку.
 */
import { load as yamlLoad } from 'js-yaml';
import type {
  AccumRegister,
  CatalogTable,
  Data,
  DocumentTable,
  Field,
  FieldType,
  InfoRegister,
  Record,
  Schema,
  Table,
  TabularSection,
} from './types';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const KIND_ORDER: Table['kind'][] = ['Справочник', 'Документ', 'РегистрНакопления', 'РегистрСведений'];

// ── Схема ──────────────────────────────────────────────────────────

export function parseSchemaYaml(text: string): Result<Schema> {
  let raw: unknown;
  try {
    raw = yamlLoad(text);
  } catch (e) {
    return err(`YAML: ${(e as Error).message}`);
  }
  if (!isObj(raw)) return err('Файл схемы должен быть YAML-объектом');
  const o = raw as { version?: unknown; tables?: unknown };
  if (o.version !== 1) return err('Поддерживается только version: 1');
  if (!Array.isArray(o.tables) || o.tables.length === 0) return err('Поле `tables` обязательно и должно содержать минимум одну запись');

  const tables: Table[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < o.tables.length; i += 1) {
    const t = parseTable(o.tables[i], i);
    if (!t.ok) return t;
    const ref = `${t.value.kind}.${t.value.name}`;
    if (seen.has(ref)) return err(`Таблица ${ref} задана дважды`);
    seen.add(ref);
    tables.push(t.value);
  }
  return ok({ version: 1, tables: tables.sort(cmpTables) });
}

function parseTable(raw: unknown, i: number): Result<Table> {
  if (!isObj(raw)) return err(`tables[${i}]: должен быть объектом`);
  const o = raw as { kind?: unknown; name?: unknown };
  if (typeof o.kind !== 'string') return err(`tables[${i}]: поле kind обязательно`);
  if (typeof o.name !== 'string' || !o.name) return err(`tables[${i}]: поле name обязательно`);
  const at = `${o.kind}.${o.name}`;
  switch (o.kind) {
    case 'Справочник': return parseCatalog(raw as PlainObj, at);
    case 'Документ': return parseDocument(raw as PlainObj, at);
    case 'РегистрНакопления': return parseAccumRegister(raw as PlainObj, at);
    case 'РегистрСведений': return parseInfoRegister(raw as PlainObj, at);
    default: return err(`tables[${i}]: неизвестный kind «${String(o.kind)}» (ожидаются: Справочник, Документ, РегистрНакопления, РегистрСведений)`);
  }
}

function parseCatalog(o: PlainObj, at: string): Result<CatalogTable> {
  const fields = parseFields(o.fields, at);
  if (!fields.ok) return fields;
  const tabular = parseTabulars(o.tabular, at);
  if (!tabular.ok) return tabular;
  return ok({
    kind: 'Справочник',
    name: String(o.name),
    fields: fields.value,
    ...(tabular.value.length ? { tabular: tabular.value } : {}),
    ...(o.hierarchical === true ? { hierarchical: true } : {}),
  });
}

function parseDocument(o: PlainObj, at: string): Result<DocumentTable> {
  const fields = parseFields(o.fields, at);
  if (!fields.ok) return fields;
  const tabular = parseTabulars(o.tabular, at);
  if (!tabular.ok) return tabular;
  return ok({
    kind: 'Документ',
    name: String(o.name),
    fields: fields.value,
    ...(tabular.value.length ? { tabular: tabular.value } : {}),
  });
}

function parseAccumRegister(o: PlainObj, at: string): Result<AccumRegister> {
  const view = o.view === 'Обороты' ? 'Обороты' : o.view === 'Остатки' ? 'Остатки' : null;
  if (!view) return err(`${at}: поле view обязательно и должно быть «Остатки» или «Обороты»`);
  const dimensions = parseFields(o.dimensions, `${at}.dimensions`);
  if (!dimensions.ok) return dimensions;
  const resources = parseFields(o.resources, `${at}.resources`);
  if (!resources.ok) return resources;
  const attributes = o.attributes !== undefined
    ? parseFields(o.attributes, `${at}.attributes`)
    : ok<Field[]>([]);
  if (!attributes.ok) return attributes;
  return ok({
    kind: 'РегистрНакопления',
    name: String(o.name),
    view,
    dimensions: dimensions.value,
    resources: resources.value,
    ...(attributes.value.length ? { attributes: attributes.value } : {}),
  });
}

function parseInfoRegister(o: PlainObj, at: string): Result<InfoRegister> {
  if (typeof o.periodic !== 'boolean') return err(`${at}: поле periodic обязательно (true/false)`);
  const dimensions = parseFields(o.dimensions, `${at}.dimensions`);
  if (!dimensions.ok) return dimensions;
  const resources = parseFields(o.resources, `${at}.resources`);
  if (!resources.ok) return resources;
  const attributes = o.attributes !== undefined
    ? parseFields(o.attributes, `${at}.attributes`)
    : ok<Field[]>([]);
  if (!attributes.ok) return attributes;
  return ok({
    kind: 'РегистрСведений',
    name: String(o.name),
    periodic: o.periodic,
    dimensions: dimensions.value,
    resources: resources.value,
    ...(attributes.value.length ? { attributes: attributes.value } : {}),
  });
}

function parseFields(raw: unknown, at: string): Result<Field[]> {
  if (raw === undefined) return ok([]);
  if (!Array.isArray(raw)) return err(`${at}.fields: должно быть массивом`);
  const fields: Field[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const f = parseField(raw[i], `${at}[${i}]`);
    if (!f.ok) return f;
    if (seen.has(f.value.name.toLowerCase())) return err(`${at}: поле «${f.value.name}» задано дважды`);
    seen.add(f.value.name.toLowerCase());
    fields.push(f.value);
  }
  return ok(fields);
}

function parseField(raw: unknown, at: string): Result<Field> {
  if (!isObj(raw)) return err(`${at}: должен быть объектом`);
  const o = raw as PlainObj;
  if (typeof o.name !== 'string' || !o.name) return err(`${at}: name обязательно`);
  if (typeof o.type !== 'string' || !o.type) return err(`${at}: type обязательно (Строка(9) / Число(15,3) / Дата / Булево / Ссылка / УникальныйИдентификатор)`);
  const ft = parseFieldType(o.type, o.refs);
  if (!ft.ok) return err(`${at}: ${ft.error}`);
  return ok({ name: o.name, type: ft.value, ...(o.key === true ? { key: true } : {}) });
}

function parseTabulars(raw: unknown, at: string): Result<TabularSection[]> {
  if (raw === undefined) return ok([]);
  if (!Array.isArray(raw)) return err(`${at}.tabular: должно быть массивом`);
  const out: TabularSection[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const t = raw[i];
    if (!isObj(t)) return err(`${at}.tabular[${i}]: должен быть объектом`);
    const o = t as PlainObj;
    if (typeof o.name !== 'string' || !o.name) return err(`${at}.tabular[${i}]: name обязательно`);
    const fields = parseFields(o.fields, `${at}.tabular[${i}]`);
    if (!fields.ok) return fields;
    out.push({ name: o.name, fields: fields.value });
  }
  return ok(out);
}

// ── Тип поля ───────────────────────────────────────────────────────

const RE_STRING = /^Строка(?:\((\d+)\))?$/u;
const RE_NUMBER = /^Число(?:\((\d+)(?:,(\d+))?\))?$/u;

/**
 * Разбирает строку типа поля: `Строка(9)`, `Число(15,3)`, `Дата`,
 * `Булево`, `Ссылка`, `УникальныйИдентификатор`. Для `Ссылка` — вторым
 * параметром берётся `refs` (`Справочник.Номенклатура`).
 */
export function parseFieldType(t: string, refs?: unknown): Result<FieldType> {
  const s = t.trim();
  if (s === 'Дата') return ok({ kind: 'Дата' });
  if (s === 'Булево') return ok({ kind: 'Булево' });
  if (s === 'УникальныйИдентификатор') return ok({ kind: 'УникальныйИдентификатор' });
  const str = RE_STRING.exec(s);
  if (str) return ok({ kind: 'Строка', ...(str[1] ? { length: Number(str[1]) } : {}) });
  const num = RE_NUMBER.exec(s);
  if (num) {
    const out: FieldType = { kind: 'Число' };
    if (num[1]) out.digits = Number(num[1]);
    if (num[2]) out.fraction = Number(num[2]);
    return ok(out);
  }
  if (s === 'Ссылка') {
    if (typeof refs !== 'string' || !refs) return err('для типа «Ссылка» обязателен `refs` (например Справочник.Номенклатура)');
    return ok({ kind: 'Ссылка', refs });
  }
  return err(`неизвестный тип «${t}»`);
}

// ── Данные ─────────────────────────────────────────────────────────

/**
 * Парсит `.data.yaml`. НЕ валидирует записи против схемы — это делает
 * `validateFixture` отдельно, чтобы можно было получить как «плохую
 * схему», так и «плохие данные» независимо.
 */
export function parseDataYaml(text: string): Result<Data> {
  let raw: unknown;
  try {
    raw = yamlLoad(text);
  } catch (e) {
    return err(`YAML: ${(e as Error).message}`);
  }
  if (!isObj(raw)) return err('Файл данных должен быть YAML-объектом');
  const o = raw as { version?: unknown; records?: unknown };
  if (o.version !== 1) return err('Поддерживается только version: 1');
  if (!isObj(o.records)) return err('Поле `records` обязательно (объект «имя таблицы → массив записей»)');
  const rec: { [ref: string]: Record[] } = {};
  for (const [key, val] of Object.entries(o.records)) {
    if (!Array.isArray(val)) return err(`records["${key}"]: должно быть массивом записей`);
    for (let i = 0; i < val.length; i += 1) {
      if (!isObj(val[i])) return err(`records["${key}"][${i}]: должна быть объектом`);
    }
    rec[key] = val as Record[];
  }
  return ok({ version: 1, records: rec });
}

/**
 * Валидирует что данные соответствуют схеме: каждый ключ `records`
 * соответствует таблице; поля записей известны схеме. Проверка
 * поверхностная — типы значений полей на этом этапе не проверяем,
 * только структуру.
 */
export function validateFixture(schema: Schema, data: Data): Result<null> {
  const known = new Map(schema.tables.map((t) => [`${t.kind}.${t.name}`, t]));
  for (const key of Object.keys(data.records)) {
    if (!known.has(key)) {
      return err(`records["${key}"]: неизвестная таблица (нет в схеме)`);
    }
  }
  return ok(null);
}

// ── helpers ────────────────────────────────────────────────────────

type PlainObj = { [k: string]: unknown };

function isObj(v: unknown): v is PlainObj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function ok<T>(value: T): { ok: true; value: T } { return { ok: true, value }; }
function err(error: string): { ok: false; error: string } { return { ok: false, error }; }

function cmpTables(a: Table, b: Table): number {
  const ka = KIND_ORDER.indexOf(a.kind);
  const kb = KIND_ORDER.indexOf(b.kind);
  if (ka !== kb) return ka - kb;
  return a.name.localeCompare(b.name, 'ru');
}
