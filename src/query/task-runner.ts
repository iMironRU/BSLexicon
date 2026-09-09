/**
 * Runner задач-запросов (#43).
 *
 * Отдельный от `judge/runner.ts` — тот работает с BSL, а этот — с языком
 * запросов. Формат результата параллелен по идеям (pass/fail/error + diff),
 * но структура диффа своя: колонки + строки, а не текстовый stdout.
 *
 * Правила сравнения (см. issue #43):
 *   - Колонки: строгий порядок и точное совпадение имён.
 *   - Строки: `ordered` — по порядку и содержимому; `unordered` — как
 *     мультимножество (в 1С без `УПОРЯДОЧИТЬ ПО` порядок не гарантирован).
 *   - Значения: NULL, 0, ""  — три разных значения. Числа сравниваются
 *     по значению (Число(2)==Число(5), если само число совпадает).
 *   - Ошибки парсера/рантайма → status: 'error' с сообщениями.
 */
import type { BslValue } from '@core/index';
import { NULL, UNDEFINED } from '@core/interpreter/values';
import type { RunError, Rowset } from './interpreter';
import { runQuery } from './interpreter';
import { buildFixture } from './fixture';
import { parseDataYaml, parseSchemaYaml, validateFixture } from './schema-loader';
import type { QueryExpected, QueryTaskSpec } from './task-format';
import { toBslValue } from './parameters';

export type QueryTaskStatus = 'pass' | 'fail' | 'error';

export interface QueryDiff {
  columns: { expected: string[]; actual: string[]; match: boolean };
  rows: {
    expected: BslValue[][];
    actual: BslValue[][];
    match: boolean;
    /**
     * Только для `ordered`: индексы первой строки, где вывод отличается
     * от эталона. Для `unordered` — пусто (сравнение мультимножеств
     * не имеет «первого расхождения»).
     */
    firstMismatch?: number;
  };
  /**
   * Что именно не так, человекочитаемо — UI показывает над таблицей
   * («Ожидалось 3 строки, у тебя 5», «В колонке 2 отличается…»).
   */
  reason: string | null;
}

export interface QueryTaskResult {
  status: QueryTaskStatus;
  /** Заполнено при status !== 'error'. */
  actual?: Rowset;
  /** Заполнено при status !== 'error'. */
  diff?: QueryDiff;
  /** Заполнено при status === 'error'. */
  errors?: RunError[];
  /** Ошибка построения фикстуры из spec.schema/spec.data (баг задачи, не ученика). */
  specError?: string;
}

/** Основная точка: прогнать запрос ученика на фикстуре задачи и сравнить с эталоном. */
export function runQueryTask(source: string, spec: QueryTaskSpec): QueryTaskResult {
  const s = parseSchemaYaml(spec.schema);
  if (!s.ok) return { status: 'error', specError: `Схема задачи: ${s.error}` };
  const d = parseDataYaml(spec.data);
  if (!d.ok) return { status: 'error', specError: `Данные задачи: ${d.error}` };
  const v = validateFixture(s.value, d.value);
  if (!v.ok) return { status: 'error', specError: `Данные не совпадают со схемой: ${v.error}` };
  const fx = buildFixture(s.value, d.value);

  const paramMap: { [name: string]: BslValue } = {};
  for (const p of spec.parameters ?? []) paramMap[p.name] = toBslValue(p.value);
  const r = runQuery(source, fx, { parameters: paramMap });
  if (!r.ok) return { status: 'error', errors: r.errors };

  const diff = compare(r.rowset, spec.expected);
  const status: QueryTaskStatus = diff.columns.match && diff.rows.match ? 'pass' : 'fail';
  return { status, actual: r.rowset, diff };
}

// ── Сравнение ────────────────────────────────────────────────────

function compare(actual: Rowset, expected: QueryExpected): QueryDiff {
  const columnsMatch = arrayEquals(actual.columns, expected.columns);
  const rowsCompare = columnsMatch
    ? compareRows(actual.rows, expected.rows, expected.kind)
    : { match: false, firstMismatch: undefined };

  const reason = buildReason(actual, expected, columnsMatch, rowsCompare);
  return {
    columns: { expected: expected.columns, actual: actual.columns, match: columnsMatch },
    rows: {
      expected: expected.rows,
      actual: actual.rows,
      match: rowsCompare.match,
      firstMismatch: rowsCompare.firstMismatch,
    },
    reason,
  };
}

function compareRows(
  actual: BslValue[][],
  expected: BslValue[][],
  kind: 'ordered' | 'unordered',
): { match: boolean; firstMismatch?: number } {
  if (actual.length !== expected.length) return { match: false };
  if (kind === 'ordered') {
    for (let i = 0; i < actual.length; i += 1) {
      if (!rowEquals(actual[i], expected[i])) return { match: false, firstMismatch: i };
    }
    return { match: true };
  }
  // unordered: мультимножество. Учебные объёмы — до сотен строк, O(n²)
  // приемлемо и не требует канонической сортировки (которая ломается на
  // NULL/mixed-type ключах).
  const used = new Set<number>();
  for (const row of actual) {
    let found = -1;
    for (let j = 0; j < expected.length; j += 1) {
      if (used.has(j)) continue;
      if (rowEquals(row, expected[j])) { found = j; break; }
    }
    if (found < 0) return { match: false };
    used.add(found);
  }
  return { match: true };
}

function rowEquals(a: BslValue[], b: BslValue[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!cellEquals(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Сравнение одной ячейки. NULL, 0, "" — три разных значения; числа —
 * по значению (без учёта Число(15,3) vs Число(2)).
 * `null` из YAML и `UNDEFINED` из интерпретатора — считаем NULL-подобным
 * (они оба «нет данных» с точки зрения ученика).
 */
function cellEquals(a: BslValue, b: BslValue): boolean {
  const aN = isNullLike(a);
  const bN = isNullLike(b);
  if (aN || bN) return aN && bN;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  // Разные типы — не равны (число != строка "5", 0 != false и т.п.).
  return false;
}

function isNullLike(v: BslValue): boolean {
  return v === NULL || v === UNDEFINED || (v as unknown) === null || (v as unknown) === undefined;
}

function arrayEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

// ── UI-hint ──────────────────────────────────────────────────────

function buildReason(
  actual: Rowset,
  expected: QueryExpected,
  columnsMatch: boolean,
  rowsCompare: { match: boolean; firstMismatch?: number },
): string | null {
  if (columnsMatch && rowsCompare.match) return null;
  if (!columnsMatch) {
    return `Колонки не совпадают. Ожидалось: ${expected.columns.join(', ')}. Твои: ${actual.columns.join(', ') || '(пусто)'}.`;
  }
  if (actual.rows.length !== expected.rows.length) {
    return `Число строк: ожидалось ${expected.rows.length}, у тебя ${actual.rows.length}.`;
  }
  if (expected.kind === 'ordered' && rowsCompare.firstMismatch !== undefined) {
    return `Строка ${rowsCompare.firstMismatch + 1} отличается от эталона. Проверь порядок и значения.`;
  }
  return `Одна из строк не соответствует эталону.`;
}
