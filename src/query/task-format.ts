/**
 * Формат `.query-task.yaml` — задача-запрос (#43).
 *
 * Расширение задачи Judge на язык запросов: помимо условия и стартового
 * кода в спеке лежит схема, данные и эталонный результат. Runner прогоняет
 * запрос ученика на этой фикстуре и сравнивает rowset с эталоном (см.
 * task-runner.ts).
 *
 * Пример YAML:
 *
 * ```yaml
 * title: Все товары
 * statement: |
 *   Выведи `Наименование` всех непомеченных на удаление позиций
 *   номенклатуры.
 * schema: |
 *   version: 1
 *   tables:
 *     - kind: Справочник
 *       name: Номенклатура
 *       ...
 * data: |
 *   version: 1
 *   records:
 *     Справочник.Номенклатура:
 *       - { Ссылка: n1, ... }
 * starter: |
 *   ВЫБРАТЬ ...
 * expected:
 *   columns: [Наименование]
 *   rows_ordered:
 *     - [Молоток]
 *     - [Отвёртка]
 * hints:
 *   - Используй ГДЕ.
 * ```
 *
 * MVP-ограничение: `schema` и `data` — только inline. Внешние ссылки
 * (`schema-ref`, `data-ref`) не поддерживаем — вернёмся к ним, когда
 * появится авторский рабочий процесс с общей папкой `datasets/`.
 */
import type { BslValue } from '@core/index';
import { load as yamlLoad } from 'js-yaml';
import { err, getStr, isObj, type Result } from '../app/parse-helpers';
import type { QueryParamEntry, QueryParamValue } from './parameters';

/** Строгий по колонкам эталон; строки — либо строго упорядочены, либо мультимножество. */
export type QueryExpected =
  | { kind: 'ordered'; columns: string[]; rows: BslValue[][] }
  | { kind: 'unordered'; columns: string[]; rows: BslValue[][] };

export interface QueryTaskSpec {
  title?: string;
  /** Markdown-условие. */
  statement: string;
  /** Стартовый текст запроса в редакторе. */
  starter: string;
  /** YAML схемы (тот же формат, что и обычный `.schema.yaml`). */
  schema: string;
  /** YAML данных под ту же схему. */
  data: string;
  expected: QueryExpected;
  /**
   * Значения параметров, которыми педагог засеивает запрос ученика перед
   * проверкой. Ученик не меняет — так же, как starter иммутабелен.
   */
  parameters?: QueryParamEntry[];
  hints?: string[];
}

/** Парсит YAML в спеку. Не бросает — возвращает discriminated union. */
export function parseQueryTaskYaml(text: string): Result<QueryTaskSpec> {
  let raw: unknown;
  try {
    raw = yamlLoad(text);
  } catch (e) {
    return err(`YAML: ${(e as Error).message}`);
  }
  if (!isObj(raw)) return err('Файл задачи-запроса должен быть YAML-объектом');
  const o = raw as Record<string, unknown>;

  const statement = getStr(o, 'statement');
  if (statement === null) return err('Поле `statement` обязательно и должно быть строкой');
  const starter = getStr(o, 'starter');
  if (starter === null) return err('Поле `starter` обязательно и должно быть строкой');
  const schema = getStr(o, 'schema');
  if (schema === null) return err('Поле `schema` обязательно (inline YAML схемы)');
  const data = getStr(o, 'data');
  if (data === null) return err('Поле `data` обязательно (inline YAML данных)');

  const expected = parseExpected(o.expected);
  if (!expected.ok) return expected;

  const spec: QueryTaskSpec = {
    statement,
    starter,
    schema,
    data,
    expected: expected.value,
  };
  const title = getStr(o, 'title');
  if (title !== null) spec.title = title;
  const hints = o.hints;
  if (Array.isArray(hints)) {
    const arr = hints.filter((h): h is string => typeof h === 'string');
    if (arr.length > 0) spec.hints = arr;
  }
  const params = parseParameters(o.parameters);
  if (params.length > 0) spec.parameters = params;
  return { ok: true, value: spec };
}

/**
 * Разбирает `parameters:` — массив объектов
 * `{name: <str>, kind: <вид>, value: <значение>, refs?: <Kind.Name>}` в
 * список `QueryParamEntry`. Тихо игнорирует битые записи — задача уже
 * загружена, нельзя ронять всё из-за одного плохого параметра.
 */
function parseParameters(raw: unknown): QueryParamEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: QueryParamEntry[] = [];
  for (const item of raw) {
    if (!isObj(item)) continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name : null;
    if (!name) continue;
    const kind = rec.kind;
    let value: QueryParamValue;
    if (kind === 'NULL' || kind === null || kind === undefined) {
      value = { kind: 'NULL' };
    } else if (kind === 'Строка' && typeof rec.value === 'string') {
      value = { kind: 'Строка', value: rec.value };
    } else if (kind === 'Число' && typeof rec.value === 'number') {
      value = { kind: 'Число', value: rec.value };
    } else if (kind === 'Булево' && typeof rec.value === 'boolean') {
      value = { kind: 'Булево', value: rec.value };
    } else if (kind === 'Дата' && typeof rec.value === 'string') {
      value = { kind: 'Дата', value: rec.value };
    } else if (kind === 'Ссылка' && typeof rec.value === 'string' && typeof rec.refs === 'string') {
      value = { kind: 'Ссылка', refs: rec.refs, value: rec.value };
    } else {
      continue;
    }
    out.push({ name, value });
  }
  return out;
}

function parseExpected(raw: unknown): Result<QueryExpected> {
  if (!isObj(raw)) return err('Поле `expected` обязательно и должно быть объектом с `columns` и `rows_ordered`/`rows_unordered`');
  const e = raw as { columns?: unknown; rows_ordered?: unknown; rows_unordered?: unknown };
  if (!Array.isArray(e.columns) || e.columns.length === 0) {
    return err('`expected.columns` должно быть непустым массивом имён колонок');
  }
  const columns = e.columns.map((c) => String(c));

  const hasOrdered = Array.isArray(e.rows_ordered);
  const hasUnordered = Array.isArray(e.rows_unordered);
  if (hasOrdered && hasUnordered) {
    return err('В `expected` должен быть либо `rows_ordered`, либо `rows_unordered`, но не оба сразу');
  }
  if (!hasOrdered && !hasUnordered) {
    return err('В `expected` должен быть `rows_ordered` или `rows_unordered`');
  }
  const rawRows = (hasOrdered ? e.rows_ordered : e.rows_unordered) as unknown[];
  const rows = rawRows.map((r) => coerceRow(r, columns.length));
  const kind: 'ordered' | 'unordered' = hasOrdered ? 'ordered' : 'unordered';
  return { ok: true, value: { kind, columns, rows } };
}

/**
 * Приводит YAML-строку к BslValue[]. Массив ждём длины `expectedLen`
 * (иначе — дополняем NULL или обрезаем: за строгостью следит уже
 * компаратор, здесь мы даём Runtime свободу выдать любую строку).
 */
function coerceRow(raw: unknown, expectedLen: number): BslValue[] {
  if (!Array.isArray(raw)) return new Array(expectedLen).fill(null) as BslValue[];
  return raw.map((v) => coerceValue(v));
}

function coerceValue(v: unknown): BslValue {
  if (v === null || v === undefined) {
    // YAML `null` / отсутствие → мы держим NULL как js-null (совместимо с
    // тем, что интерпретатор возвращает для NULL-выражений в rowset).
    return null as unknown as BslValue;
  }
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  // Дата, массив или объект — сериализуем как строку (учебный формат ждёт
  // примитивы; сложное — редко нужно, авторам скажем избегать).
  if (v instanceof Date) return v.toISOString().slice(0, 19);
  return JSON.stringify(v);
}

