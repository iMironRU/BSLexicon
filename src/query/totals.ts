/**
 * ИТОГИ ... ПО (#45).
 *
 * Итоги — это не отдельный ответ, а строки-итоги, вставленные в тот же
 * результат: сначала общий итог, потом по каждой контрольной точке — её
 * итог и следом подробности. Так это и устроено в платформе: результат
 * запроса с итогами — дерево, а линейный обход отдаёт его сверху вниз.
 *
 * Считаем поверх готового результата: строки уже посчитаны, отсортированы
 * и лежат в `Rowset`. Отсюда простое правило соответствия: контрольная
 * точка и аргумент итоговой функции ищутся среди колонок результата — по
 * тому же имени, по которому их находит УПОРЯДОЧИТЬ ПО.
 */
import type { BslValue } from '@core/index';
import { NULL, UNDEFINED } from '@core/interpreter/values';
import { compareValues } from '@core/interpreter/values';
import type { ParserRuleContext } from 'antlr4ng';
import type { TotalByContext } from './parser/generated/SDBLParser';

/** Чем является строка результата. `null` — обычная, число — уровень итога (0 — общий). */
export type TotalLevel = number | null;

export interface TotalsInput {
  columns: string[];
  rows: BslValue[][];
  /** Колонки-агрегаты списка выборки: индекс и имя функции. */
  aggregates: { index: number; func: string }[];
  /** Был ли СГРУППИРОВАТЬ ПО: от этого зависит, как складывать уже посчитанное. */
  grouped: boolean;
  /** Имя колонки по выражению — то же правило, что у УПОРЯДОЧИТЬ ПО. */
  nameOf: (expr: ParserRuleContext) => string;
  warn: (message: string) => void;
  fail: (message: string) => never;
}

export interface TotalsOutput {
  rows: BslValue[][];
  levels: TotalLevel[];
}

const FUNC_ALIASES: { [k: string]: string } = {
  SUM: 'СУММА', COUNT: 'КОЛИЧЕСТВО', MIN: 'МИНИМУМ', MAX: 'МАКСИМУМ', AVG: 'СРЕДНЕЕ',
};

/** Имя агрегатной функции, если всё выражение — её вызов. Иначе null. */
export function aggregateFuncOf(text: string): string | null {
  const m = /^\s*(СУММА|КОЛИЧЕСТВО|МИНИМУМ|МАКСИМУМ|СРЕДНЕЕ|SUM|COUNT|MIN|MAX|AVG)\s*\(/i.exec(text);
  if (!m) return null;
  const raw = m[1].toUpperCase();
  return FUNC_ALIASES[raw] ?? raw;
}

export function applyTotals(input: TotalsInput, totals: TotalByContext): TotalsOutput {
  const points = readControlPoints(input, totals);
  const fields = readTotalFields(input, totals);

  const sorted = sortByPoints(input.rows, points);
  const out: BslValue[][] = [];
  const levels: TotalLevel[] = [];

  if (points.overall) {
    out.push(totalRow(input, fields, points.list, sorted, -1));
    levels.push(0);
  }

  const walk = (rows: BslValue[][], depth: number): void => {
    if (depth === points.list.length) {
      for (const r of rows) { out.push(r); levels.push(null); }
      return;
    }
    for (const group of groupByColumn(rows, points.list[depth].index)) {
      out.push(totalRow(input, fields, points.list, group, depth));
      levels.push(depth + 1);
      walk(group, depth + 1);
    }
  };
  walk(sorted, 0);

  return { rows: out, levels };
}

// ── Разбор предложения ────────────────────────────────────────────

interface ControlPoint { name: string; index: number }

function readControlPoints(input: TotalsInput, totals: TotalByContext): { overall: boolean; list: ControlPoint[] } {
  const groups = totals._totalsGroups ?? [];
  if (groups.length === 0) input.fail('После ИТОГИ ... ПО не указано ни одной контрольной точки.');

  let overall = false;
  const list: ControlPoint[] = [];
  for (const g of groups) {
    if (g.OVERALL()) { overall = true; continue; }
    if (g._hierarchyType) input.fail('ИТОГИ ПО ... ИЕРАРХИЯ пока не поддержаны — уберите ИЕРАРХИЯ.');
    if (g.periodic?.()) input.fail('ИТОГИ ПО ... ПЕРИОДАМИ пока не поддержаны.');
    const expr = g.expression();
    if (!expr) input.fail('Некорректная контрольная точка в ИТОГИ ПО.');
    const name = readAlias(g) ?? input.nameOf(expr);
    list.push({ name, index: columnIndex(input, name, 'Контрольная точка') });
  }
  return { overall, list };
}

interface TotalField { func: string; index: number }

function readTotalFields(input: TotalsInput, totals: TotalByContext): TotalField[] {
  const container = totals.selectedFields?.();
  if (!container) {
    // Список не задан: берём агрегаты из списка выборки — как в платформе.
    if (input.aggregates.length === 0) {
      input.warn('В ИТОГИ не указано ни одной функции, а в выборке нет агрегатов — строки-итоги придут пустыми.');
    }
    return input.aggregates.map((a) => ({ func: a.func, index: a.index }));
  }

  const out: TotalField[] = [];
  for (const f of container.selectedField()) {
    const expr = f.expressionField()?.expression();
    if (!expr) input.fail('В ИТОГИ ожидалась агрегатная функция, например СУММА(Продано).');
    const text = expr.getText();
    const func = aggregateFuncOf(text);
    if (!func) {
      input.fail(`Итоговое поле «${text}» — не агрегатная функция. В ИТОГИ пишут СУММА(...), КОЛИЧЕСТВО(...) и подобные.`);
    }
    const argName = argumentName(input, expr);
    out.push({ func, index: columnIndex(input, argName, 'Итоговое поле') });
  }
  return out;
}

/** Имя колонки, по которой считается итог: аргумент функции или её псевдоним. */
function argumentName(input: TotalsInput, expr: ParserRuleContext): string {
  const text = expr.getText();
  const inner = /\(([^()]*)\)/.exec(text)?.[1] ?? '';
  const cleaned = inner.trim();
  if (cleaned === '' || cleaned === '*') {
    input.fail('КОЛИЧЕСТВО(*) в ИТОГИ пока не поддержано — назовите поле явно.');
  }
  const last = cleaned.split('.').pop() ?? cleaned;
  return last;
}

function columnIndex(input: TotalsInput, name: string, what: string): number {
  const i = input.columns.findIndex((c) => c.toUpperCase() === name.toUpperCase());
  if (i < 0) {
    input.fail(
      `${what} «${name}» не найдена среди колонок результата: ${input.columns.join(', ')}. ` +
      'В ИТОГИ можно ссылаться только на то, что есть в ВЫБРАТЬ.',
    );
  }
  return i;
}

function readAlias(node: { alias?: () => { identifier?: () => { getText(): string } | null } | null }): string | null {
  const a = node.alias?.();
  const id = a?.identifier?.();
  return id ? id.getText() : null;
}

// ── Сборка строк ──────────────────────────────────────────────────

function sortByPoints(rows: BslValue[][], points: { list: ControlPoint[] }): BslValue[][] {
  const order = rows.map((_, i) => i);
  order.sort((a, b) => {
    for (const p of points.list) {
      const c = compareValues(rows[a][p.index], rows[b][p.index]);
      if (c !== undefined && c !== 0) return c;
    }
    return a - b; // устойчиво: внутри группы порядок УПОРЯДОЧИТЬ ПО сохраняется
  });
  return order.map((i) => rows[i]);
}

function groupByColumn(rows: BslValue[][], index: number): BslValue[][][] {
  const out: BslValue[][][] = [];
  let current: BslValue[][] | null = null;
  let key: BslValue | undefined;
  for (const r of rows) {
    if (current === null || compareValues(key as BslValue, r[index]) !== 0) {
      current = [];
      out.push(current);
      key = r[index];
    }
    current.push(r);
  }
  return out;
}

function totalRow(
  input: TotalsInput,
  fields: TotalField[],
  points: ControlPoint[],
  group: BslValue[][],
  depth: number,
): BslValue[] {
  const row: BslValue[] = input.columns.map(() => NULL);
  for (let d = 0; d <= depth; d += 1) {
    row[points[d].index] = group[0][points[d].index];
  }
  for (const f of fields) {
    row[f.index] = aggregate(input, f.func, group.map((r) => r[f.index]));
  }
  return row;
}

function aggregate(input: TotalsInput, func: string, values: BslValue[]): BslValue {
  const numbers = values.filter((v) => typeof v === 'number') as number[];
  const filled = values.filter((v) => v !== NULL && v !== UNDEFINED);

  switch (func) {
    case 'СУММА':
      return numbers.reduce((a, b) => a + b, 0);
    case 'КОЛИЧЕСТВО':
      // Над уже свёрнутым результатом количества складываются: итог по
      // группам — это сумма их количеств, а не число строк-групп.
      return input.grouped ? numbers.reduce((a, b) => a + b, 0) : filled.length;
    case 'МИНИМУМ':
      return numbers.length ? Math.min(...numbers) : NULL;
    case 'МАКСИМУМ':
      return numbers.length ? Math.max(...numbers) : NULL;
    case 'СРЕДНЕЕ':
      if (input.grouped) {
        input.warn('СРЕДНЕЕ в ИТОГИ считается по строкам результата: над сгруппированным это среднее средних.');
      }
      return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : NULL;
    default:
      input.fail(`Функция «${func}» в ИТОГИ пока не поддержана.`);
  }
}
