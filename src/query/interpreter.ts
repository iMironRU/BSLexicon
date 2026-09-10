/**
 * Интерпретатор языка запросов 1С (#40, стратегия A из Q1).
 *
 * Обходит ANTLR-дерево SDBLParser через typed accessors, работает поверх
 * `Fixture` (см. fixture.ts) и возвращает табличный результат
 * `{columns, rows}`.
 *
 * MVP покрывает то что покрывает парсер, минус (даёт понятную runtime-
 * ошибку «пока не реализовано»):
 *  - виртуальные таблицы регистров (#44, #47)
 *  - ИТОГИ ПО (#45)
 *  - пакеты + временные таблицы (#46)
 */
import type { BslValue } from '@core/index';
import { NULL, UNDEFINED } from '@core/interpreter/values';
import { compareValues, isTruthy, toBslString, toNumber, valuesEqual } from '@core/interpreter/values';
import type { ParserRuleContext, TerminalNode } from 'antlr4ng';
import { parseQuery } from './parser/parse';
import type { Fixture, Row } from './fixture';
import {
  AliasContext,
  ColumnContext,
  DataSourceContext,
  ExpressionContext,
  IdentifierContext,
  JoinPartContext,
  LogicalExpressionContext,
  MdoContext,
  MultiStringContext,
  OrderByContext,
  ParameterContext,
  PredicateContext,
  QueryContext,
  QueryPackageContext,
  SelectQueryContext,
  SubqueryContext,
  TableContext,
  VirtualTableContext,
} from './parser/generated/SDBLParser';
import { materializeVirtual, type VirtualMethod } from './virtual-tables';
import { aggregateFuncOf, applyTotals, type TotalLevel } from './totals';
import type { Field } from './types';
import { extractParamName } from './parameters';

// ── Публичный API ──────────────────────────────────────────────────

export interface Rowset {
  columns: string[];
  rows: BslValue[][];
  /**
   * Строки-итоги (#45): `null` — обычная строка, число — уровень итога
   * (0 — общий, дальше по контрольным точкам). Массив идёт вровень с
   * `rows` и появляется только когда в запросе есть ИТОГИ.
   */
  totalLevels?: TotalLevel[];
}

export interface RunError {
  stage: 'parser' | 'runtime';
  message: string;
  line?: number;
  column?: number;
}

export type RunResult =
  | { ok: true; rowset: Rowset; warnings: string[] }
  | { ok: false; errors: RunError[] };

export class QueryRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryRuntimeError';
  }
}

/** Опции прогона запроса. */
export interface RunOptions {
  /** Значения параметров `&Имя` — если параметр не задан, интерпретатор предупредит. */
  parameters?: { [name: string]: BslValue };
}

export function runQuery(source: string, fx: Fixture, options: RunOptions = {}): RunResult {
  const parsed = parseQuery(source);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors.map((e) => ({ stage: 'parser', message: e.message, line: e.line, column: e.column })) };
  }
  try {
    const { rowset, warnings } = execPackage(parsed.tree as QueryPackageContext, fx, options);
    return { ok: true, rowset, warnings };
  } catch (e) {
    if (e instanceof QueryRuntimeError) return { ok: false, errors: [{ stage: 'runtime', message: e.message }] };
    return { ok: false, errors: [{ stage: 'runtime', message: (e as Error).message ?? String(e) }] };
  }
}

// ── Дерево ──────────────────────────────────────────────────────────

interface ExecResult {
  rowset: Rowset;
  warnings: string[];
  /** Колонки-агрегаты списка выборки — нужны ИТОГИ без списка функций. */
  aggregates?: { index: number; func: string }[];
  /** Был ли СГРУППИРОВАТЬ ПО — от этого зависит сложение уже посчитанного. */
  grouped?: boolean;
}

function execPackage(pkg: QueryPackageContext, fx: Fixture, options: RunOptions): ExecResult {
  const queries = pkg.queries();
  if (queries.length === 0) throw new QueryRuntimeError('Пустой пакет запросов');
  if (queries.length > 1) throw new QueryRuntimeError('Пакеты запросов пока не поддерживаются (см. #46)');
  const q = queries[0];
  if (q.dropTableQuery()) throw new QueryRuntimeError('УНИЧТОЖИТЬ пока не поддерживается (см. #46)');
  const sel = q.selectQuery();
  if (!sel) throw new QueryRuntimeError('Ожидался ВЫБРАТЬ-запрос');
  return execSelectQuery(sel, fx, options);
}

function execSelectQuery(node: SelectQueryContext, fx: Fixture, options: RunOptions): ExecResult {
  const sub = node.subquery() as SubqueryContext | null;
  if (!sub) throw new QueryRuntimeError('Пустой SELECT');
  if (sub._unions && sub._unions.length > 0) throw new QueryRuntimeError('ОБЪЕДИНИТЬ пока не поддерживается (следующий шаг)');
  const main = sub._main;
  if (!main) throw new QueryRuntimeError('Отсутствует основная часть SELECT');
  if (main.temporaryTableIdentifier?.()) throw new QueryRuntimeError('ПОМЕСТИТЬ пока не поддерживается (#46)');

  const { rowset, warnings, aggregates, grouped } = execQuery(main, fx, options);

  // ORDER BY может быть либо в subquery (стандартное место), либо на
  // уровне selectQuery (после ИТОГИ / АВТОУПОРЯДОЧИВАНИЕ).
  const orderBy = node._orders ?? sub.orderBy?.();
  if (orderBy) applyOrderBy(rowset, orderBy);

  if (node._totals) {
    const extra = new Set<string>();
    const { rows, levels } = applyTotals({
      columns: rowset.columns,
      rows: rowset.rows,
      aggregates: aggregates ?? [],
      grouped: grouped ?? false,
      nameOf: defaultAliasFromExpr,
      warn: (m) => extra.add(m),
      fail: (m) => { throw new QueryRuntimeError(m); },
    }, node._totals);
    rowset.rows = rows;
    rowset.totalLevels = levels;
    return { rowset, warnings: [...warnings, ...extra] };
  }

  return { rowset, warnings };
}

interface QueryCtx {
  fx: Fixture;
  /** алиас источника → полное имя таблицы. */
  sources: Map<string, string>;
  /**
   * Для виртуальных источников — переопределённый список полей (Приход/Расход/
   * КоличествоОстаток и т.п.). Обычные таблицы не пишутся сюда — их поля
   * берутся из схемы через `ctx.sources`.
   */
  virtualFields: Map<string, Field[]>;
  /** Значения параметров `&Имя` — то, что задано снаружи. */
  parameters: Map<string, BslValue>;
  /** Собранные warning'и: неизвестные поля, битые ссылки. */
  warnings: Set<string>;
}

/** Одна «строка-снимок»: алиас → Row исходной таблицы. */
type Snap = Map<string, Row>;

function execQuery(q: QueryContext, fx: Fixture, options: RunOptions): ExecResult {
  const params = new Map<string, BslValue>();
  for (const [k, v] of Object.entries(options.parameters ?? {})) params.set(k, v);
  const ctx: QueryCtx = { fx, sources: new Map(), virtualFields: new Map(), parameters: params, warnings: new Set() };

  // FROM
  const snaps: Snap[] = q._from_ ? collectDataSources(q._from_.dataSource(), ctx) : [new Map()];

  // WHERE
  const filtered = q._where ? snaps.filter((s) => isTruthy(evalNode(q._where!, s, ctx, null))) : snaps;

  // SELECT
  const columnSpecs = collectSelectedFields(q, ctx);

  // GROUP BY / HAVING / агрегаты
  const groupExprs = q._groupBy ?? [];
  const hasAgg = columnSpecs.some((c) => c.kind === 'expr' && containsAggregate(c.expr));

  if (groupExprs.length > 0 || hasAgg) {
    const groups = new Map<string, Snap[]>();
    if (groupExprs.length === 0) {
      groups.set('', filtered);
    } else {
      for (const s of filtered) {
        const key = groupExprs.map((g) => JSON.stringify(evalNode(g, s, ctx, null))).join('|');
        let bucket = groups.get(key);
        if (!bucket) { bucket = []; groups.set(key, bucket); }
        bucket.push(s);
      }
    }
    const rows: BslValue[][] = [];
    for (const bucket of groups.values()) {
      if (q._having && !isTruthy(evalNode(q._having, bucket[0] ?? new Map(), ctx, bucket))) continue;
      rows.push(columnSpecs.map((c) => evalOutputColumn(c, bucket[0] ?? new Map(), ctx, bucket)));
    }
    return {
      rowset: { columns: columnSpecs.map((c) => c.name), rows },
      warnings: [...ctx.warnings],
      aggregates: aggregateColumns(columnSpecs),
      grouped: true,
    };
  }

  const rows: BslValue[][] = filtered.map((s) => columnSpecs.map((c) => evalOutputColumn(c, s, ctx, null)));
  return {
    rowset: { columns: columnSpecs.map((c) => c.name), rows },
    warnings: [...ctx.warnings],
    aggregates: aggregateColumns(columnSpecs),
    grouped: false,
  };
}

/** Колонки списка выборки, которые сами по себе агрегат: их и суммируют ИТОГИ без списка функций. */
function aggregateColumns(specs: ColumnSpec[]): { index: number; func: string }[] {
  const out: { index: number; func: string }[] = [];
  specs.forEach((c, index) => {
    if (c.kind !== 'expr') return;
    const func = aggregateFuncOf(c.expr.getText());
    if (func) out.push({ index, func });
  });
  return out;
}

/** Универсальный eval итоговой колонки: раскрытая `*` → прямое чтение поля, иначе expr. */
function evalOutputColumn(c: ColumnSpec, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  if (c.kind === 'field') {
    const row = snap.get(c.sourceAlias);
    if (!row) return UNDEFINED;
    const v = (row as Row)[c.fieldName];
    // Табличные части — Row[] — не выводим в результат: показываем счёт.
    if (Array.isArray(v)) return `<таб. часть: ${v.length}>`;
    return v as BslValue;
  }
  return evalNode(c.expr, snap, ctx, bucket);
}

// ── Источники ─────────────────────────────────────────────────────

function collectDataSources(dataSources: DataSourceContext[], ctx: QueryCtx): Snap[] {
  let out: Snap[] | null = null;
  for (const ds of dataSources) {
    if (ds.parameterTable?.()) throw new QueryRuntimeError('Параметрические таблицы пока не поддерживаются');
    if (ds.externalDataSourceTable?.()) throw new QueryRuntimeError('Внешние источники данных пока не поддерживаются');
    if (ds.subquery?.()) throw new QueryRuntimeError('Подзапросы в FROM пока не поддерживаются');
    // alias находится в DataSourceContext (sibling с table), не в TableContext
    const alias = readAlias(ds);
    let snaps: Snap[];
    const vt = ds.virtualTable?.();
    if (vt) {
      snaps = readVirtualTable(vt, ctx, alias);
    } else {
      const primary = ds.table();
      if (!primary) throw new QueryRuntimeError('Некорректный источник ИЗ');
      snaps = readTable(primary, ctx, alias);
    }
    for (const j of ds._joins ?? []) snaps = applyJoin(snaps, j, ctx);
    out = out === null ? snaps : cross(out, snaps);
  }
  return out ?? [];
}

function readTable(table: TableContext, ctx: QueryCtx, aliasOverride?: string | null): Snap[] {
  const mdo = table.mdo();
  if (!mdo) throw new QueryRuntimeError('Источник не является объектом метаданных');

  const ref = mdoRef(mdo);
  const tf = ctx.fx.tables.get(ref);
  if (!tf) throw new QueryRuntimeError(`Таблица «${ref}» не найдена в схеме`);

  // «Документ.РасходнаяНакладная.Товары» — источником становится табличная
  // часть, а не сам документ (issue #49). `objectTableName` в грамматике —
  // третий сегмент после MDO.
  const objTableName = table._objectTableName?.getText();
  if (objTableName) {
    return readTabularSection(ref, tf.table, objTableName, ctx, aliasOverride ?? readAlias(table));
  }

  const rows = tf.rows;
  const alias = aliasOverride ?? readAlias(table) ?? ref;
  ctx.sources.set(alias, ref);
  return rows.map((r) => new Map([[alias, r]]) as Snap);
}

/**
 * Раскрывает табличную часть документа/справочника в самостоятельный источник
 * запроса. Каждая строка ТЧ получает синтетическое поле `Ссылка`, указывающее
 * на владельца — так работает `Т.Ссылка.Реквизит` (разыменование шапки).
 */
function readTabularSection(
  ownerRef: string,
  ownerTable: import('./types').Table,
  tsName: string,
  ctx: QueryCtx,
  aliasOverride?: string | null,
): Snap[] {
  if (ownerTable.kind !== 'Справочник' && ownerTable.kind !== 'Документ') {
    throw new QueryRuntimeError(`Табличные части есть только у справочников и документов; «${ownerRef}» — ${ownerTable.kind}.`);
  }
  const ts = ownerTable.tabular?.find((t) => t.name === tsName);
  if (!ts) throw new QueryRuntimeError(`Табличная часть «${tsName}» не найдена у «${ownerRef}».`);

  const parent = ctx.fx.tables.get(ownerRef)!;
  const rows: Row[] = [];
  for (const parentRow of parent.rows) {
    const inner = parentRow[ts.name];
    if (!Array.isArray(inner)) continue;
    const ownerKey = parentRow['Ссылка'] as BslValue;
    for (const r of inner) {
      rows.push({ ...r, Ссылка: ownerKey });
    }
  }
  const alias = aliasOverride ?? `${ownerRef}.${tsName}`;
  // sources → на владельца, чтобы разыменование Ссылка → шапка работало из
  // коробки через findRefsField.
  ctx.sources.set(alias, ownerRef);
  // Регистрируем список полей источника: реальные поля ТЧ + синтетическая
  // Ссылка на владельца. `expandAsterisk` использует эти поля для `Т.*`.
  ctx.virtualFields.set(alias, [
    { name: 'Ссылка', type: { kind: 'Ссылка', refs: ownerRef } },
    ...ts.fields,
  ]);
  return rows.map((r) => new Map([[alias, r]]) as Snap);
}

function readVirtualTable(vt: VirtualTableContext, ctx: QueryCtx, aliasOverride?: string | null): Snap[] {
  const mdo = vt.mdo();
  if (!mdo) throw new QueryRuntimeError('Виртуальная таблица без объекта метаданных');
  const ref = mdoRef(mdo);
  const tf = ctx.fx.tables.get(ref);
  if (!tf) throw new QueryRuntimeError(`Регистр «${ref}» не найден в схеме`);
  if (tf.table.kind !== 'РегистрНакопления') {
    throw new QueryRuntimeError(`Виртуальные таблицы поддержаны только для регистров накопления (сведений — см. #47). «${ref}» — ${tf.table.kind}.`);
  }

  const method = virtualMethod(vt);
  // .Остатки и .ОстаткиИОбороты живут только у регистра остатков (в справке
  // 1С прямо: «Таблица существует только для регистров остатков»). .Обороты —
  // у обоих видов (см. #51).
  if ((method === 'Остатки' || method === 'ОстаткиИОбороты') && tf.table.view !== 'Остатки') {
    throw new QueryRuntimeError(
      `Регистр «${ref}» — оборотный (view: 'Обороты'). ` +
      `Виртуальная ${method} доступна только для регистров остатков; используй .Обороты.`,
    );
  }
  const { params, filter } = collectVirtualParams(vt, ctx, method, ref);
  const materialized = materializeVirtual(ctx.fx, { ref, method, params, filter });

  const alias = aliasOverride ?? ref;
  ctx.sources.set(alias, ref);
  ctx.virtualFields.set(alias, materialized.virtualFields);
  return materialized.rows.map((r) => new Map([[alias, r]]) as Snap);
}

function virtualMethod(vt: VirtualTableContext): VirtualMethod {
  // _virtualTableName — токен, попадает в getText() того же узла, но проще
  // прочитать через явные accessors по типу.
  if (vt.BALANCE_VT()) return 'Остатки';
  if (vt.TURNOVERS_VT()) return 'Обороты';
  if (vt.BALANCE_AND_TURNOVERS_VT()) return 'ОстаткиИОбороты';
  if (vt.SLICELAST_VT()) throw new QueryRuntimeError('СрезПоследних пока не реализован (#47)');
  if (vt.SLICEFIRST_VT()) throw new QueryRuntimeError('СрезПервых пока не реализован (#47)');
  if (vt.BOUNDARIES_VT()) throw new QueryRuntimeError('Границы пока не реализованы');
  throw new QueryRuntimeError('Неизвестный тип виртуальной таблицы');
}

/**
 * Позиция условия в скобках — как в синтаксисе платформы:
 *   Остатки(Период, Условие)
 *   Обороты(Начало, Конец, Периодичность, Условие)
 *   ОстаткиИОбороты(Начало, Конец, Периодичность, МетодДополнения, Условие)
 */
const CONDITION_AT: { [k in VirtualMethod]: number } = {
  'Остатки': 1,
  'Обороты': 3,
  'ОстаткиИОбороты': 4,
};

/** Похоже ли выражение на условие отбора, а не на значение. */
function looksLikeCondition(text: string): boolean {
  return /(<>|>=|<=|=|>|<)|\bПОДОБНО\b|\bМЕЖДУ\b|\bЕСТЬ\b/i.test(text);
}

/**
 * Разбирает скобки виртуальной таблицы: значения вычисляем сразу, а
 * условие оставляем выражением — его надо применить к каждому движению
 * при сборке итога, а не вычислять на пустом месте (#59).
 */
function collectVirtualParams(
  vt: VirtualTableContext,
  ctx: QueryCtx,
  method: VirtualMethod,
  ref: string,
): { params: BslValue[]; filter?: (movement: Row) => boolean } {
  const raw = vt.virtualTableParameter();
  const list = Array.isArray(raw) ? raw : [];
  const at = CONDITION_AT[method];

  const params: BslValue[] = [];
  let filter: ((movement: Row) => boolean) | undefined;

  list.forEach((p, i) => {
    const expr = p.logicalExpression();
    if (!expr) { params.push(UNDEFINED); return; }

    if (i === at) {
      filter = makeMovementFilter(expr, ctx, ref);
      params.push(UNDEFINED);
      return;
    }

    if (looksLikeCondition(expr.getText())) {
      throw new QueryRuntimeError(
        `Условие отбора в виртуальной таблице стоит последним параметром. ` +
        `Для ${method} это ${at + 1}-й: ${signatureHint(method)}. ` +
        `Пропущенные параметры оставляют пустыми: ${exampleHint(method)}`,
      );
    }
    params.push(evalNode(expr, new Map(), ctx, null));
  });

  return { params, filter };
}

function signatureHint(method: VirtualMethod): string {
  switch (method) {
    case 'Остатки': return 'Остатки(Период, Условие)';
    case 'Обороты': return 'Обороты(Начало, Конец, Периодичность, Условие)';
    case 'ОстаткиИОбороты': return 'ОстаткиИОбороты(Начало, Конец, Периодичность, МетодДополнения, Условие)';
  }
}

function exampleHint(method: VirtualMethod): string {
  switch (method) {
    case 'Остатки': return 'Остатки(, Склад = &Склад)';
    case 'Обороты': return 'Обороты(&Начало, &Конец, , Склад = &Склад)';
    case 'ОстаткиИОбороты': return 'ОстаткиИОбороты(&Начало, &Конец, , , Склад = &Склад)';
  }
}

/**
 * Предикат по одному движению. Снимок — одна строка регистра под его же
 * именем, поэтому в условии пишут поля регистра как есть: `Склад = &Склад`.
 */
function makeMovementFilter(
  expr: LogicalExpressionContext,
  ctx: QueryCtx,
  ref: string,
): (movement: Row) => boolean {
  ctx.sources.set(ref, ref);
  return (movement: Row) => isTruthy(evalNode(expr, new Map([[ref, movement]]), ctx, null));
}

function applyJoin(left: Snap[], j: JoinPartContext, ctx: QueryCtx): Snap[] {
  const rightSrc = j._source ?? j.dataSource();
  if (!rightSrc) throw new QueryRuntimeError('Соединение без источника');
  const right = collectDataSources([rightSrc], ctx);
  const on = j._condition ?? j.logicalExpression?.();
  if (!on) throw new QueryRuntimeError('Соединение без ПО-условия');

  const kind = joinKind(j);
  const matched: Snap[] = [];
  const leftMatched = new Set<number>();
  const rightMatched = new Set<number>();

  for (let i = 0; i < left.length; i += 1) {
    for (let k = 0; k < right.length; k += 1) {
      const merged: Snap = new Map(left[i]);
      for (const [k2, v2] of right[k]) merged.set(k2, v2);
      if (isTruthy(evalNode(on, merged, ctx, null))) {
        matched.push(merged);
        leftMatched.add(i);
        rightMatched.add(k);
      }
    }
  }

  const rightKeys = right[0] ? [...right[0].keys()] : [];
  const leftKeys = left[0] ? [...left[0].keys()] : [];

  if (kind === 'LEFT' || kind === 'FULL') {
    for (let i = 0; i < left.length; i += 1) {
      if (leftMatched.has(i)) continue;
      const snap: Snap = new Map(left[i]);
      for (const k of rightKeys) snap.set(k, {});
      matched.push(snap);
    }
  }
  if (kind === 'RIGHT' || kind === 'FULL') {
    for (let k = 0; k < right.length; k += 1) {
      if (rightMatched.has(k)) continue;
      const snap: Snap = new Map(right[k]);
      for (const l of leftKeys) snap.set(l, {});
      matched.push(snap);
    }
  }

  return matched;
}

function cross(a: Snap[], b: Snap[]): Snap[] {
  const out: Snap[] = [];
  for (const x of a) for (const y of b) {
    const s: Snap = new Map(x);
    for (const [k, v] of y) s.set(k, v);
    out.push(s);
  }
  return out;
}

// ── SELECT list ────────────────────────────────────────────────────

/**
 * Одна колонка результата:
 *  - `kind: 'expr'` — обычное выражение, вычисляется через evalNode;
 *  - `kind: 'field'` — раскрытая `*` / `Т.*` — прямое чтение поля
 *    без парсинга выражения.
 */
type ColumnSpec =
  | { name: string; kind: 'expr'; expr: ExpressionContext | LogicalExpressionContext }
  | { name: string; kind: 'field'; sourceAlias: string; fieldName: string };

function collectSelectedFields(q: QueryContext, ctx: QueryCtx): ColumnSpec[] {
  const container = q._columns;
  if (!container) throw new QueryRuntimeError('Отсутствует список полей ВЫБРАТЬ');
  const fields = container.selectedField();
  const out: ColumnSpec[] = [];
  for (const f of fields) {
    const aster = f.asteriskField();
    if (aster) {
      // Т.* → только поля источника Т; * → все поля всех источников
      const idents = aster.identifier();
      const targetAlias = idents.length > 0 ? idents[idents.length - 1].getText() : null;
      const expanded = expandAsterisk(ctx, targetAlias);
      out.push(...expanded);
      continue;
    }
    const exprField = f.expressionField();
    if (!exprField) throw new QueryRuntimeError('Не удалось разобрать поле ВЫБРАТЬ');
    const expr = exprField.expression() ?? exprField.logicalExpression();
    if (!expr) throw new QueryRuntimeError('Не удалось разобрать выражение поля');
    const alias = readAlias(f) ?? defaultAliasFromExpr(expr);
    out.push({ name: alias, kind: 'expr', expr });
  }
  return out;
}

/** Раскрывает `*` / `Т.*` в список полей активных источников. */
function expandAsterisk(ctx: QueryCtx, only: string | null): ColumnSpec[] {
  const out: ColumnSpec[] = [];
  const takenNames = new Map<string, number>();
  for (const [alias, tableRef] of ctx.sources) {
    if (only && alias !== only) continue;
    // Виртуальный источник переопределяет список полей.
    const overrideFields = ctx.virtualFields.get(alias);
    let fields: { name: string }[];
    if (overrideFields) {
      fields = overrideFields;
    } else {
      const table = ctx.fx.tables.get(tableRef)?.table;
      if (!table) continue;
      fields = tableRef.startsWith('Справочник.') || tableRef.startsWith('Документ.')
        ? (table as { fields?: { name: string }[] }).fields ?? []
        : [
            ...(table as { dimensions?: { name: string }[] }).dimensions ?? [],
            ...(table as { resources?: { name: string }[] }).resources ?? [],
            ...(table as { attributes?: { name: string }[] }).attributes ?? [],
          ];
    }
    for (const f of fields) {
      let name = f.name;
      // При объединении полей из нескольких источников имена коллизят —
      // добавляем суффикс алиаса, чтобы каждая колонка была уникальна.
      const seen = takenNames.get(name) ?? 0;
      if (seen > 0) name = `${f.name}${seen + 1}`;
      takenNames.set(f.name, seen + 1);
      out.push({ name, kind: 'field', sourceAlias: alias, fieldName: f.name });
    }
  }
  if (out.length === 0 && only) {
    throw new QueryRuntimeError(`Источник «${only}» не найден в ИЗ`);
  }
  return out;
}

function defaultAliasFromExpr(expr: ParserRuleContext): string {
  // Простая колонка «Т.Наименование» → «Наименование». Для сложного — getText.
  const col = findFirst(expr, ColumnContext);
  if (col) {
    const idents = col.identifier();
    if (idents.length > 0) return idents[idents.length - 1].getText();
    if (col._columnNames?.length) return col._columnNames[col._columnNames.length - 1].getText();
  }
  return expr.getText();
}

// ── ORDER BY ──────────────────────────────────────────────────────

function applyOrderBy(rowset: Rowset, orderBy: OrderByContext): void {
  const items = orderBy.ordersByExpression();
  if (!items || items.length === 0) return;
  const specs = items.map((it) => {
    const expr = it.expression();
    if (!expr) throw new QueryRuntimeError('Некорректное УПОРЯДОЧИТЬ ПО');
    const colName = defaultAliasFromExpr(expr);
    const dir = it._direction?.text?.toUpperCase() === 'DESC' || it._direction?.text?.toUpperCase() === 'УБЫВ' ? -1 : 1;
    return { colName, dir };
  });
  const idx = new Map(rowset.columns.map((c, i) => [c, i]));
  rowset.rows.sort((a, b) => {
    for (const s of specs) {
      const i = idx.get(s.colName);
      if (i === undefined) continue;
      const c = compareValues(a[i], b[i]);
      if (c === undefined) continue;
      if (c !== 0) return s.dir * c;
    }
    return 0;
  });
}

// ── Выражения ──────────────────────────────────────────────────────

const AGGREGATE_FUNCS = new Set(['СУММА', 'КОЛИЧЕСТВО', 'МИНИМУМ', 'МАКСИМУМ', 'СРЕДНЕЕ',
  'SUM', 'COUNT', 'MIN', 'MAX', 'AVG']);

const AGG_ALIAS: { [k: string]: string } = {
  SUM: 'СУММА', COUNT: 'КОЛИЧЕСТВО', MIN: 'МИНИМУМ', MAX: 'МАКСИМУМ', AVG: 'СРЕДНЕЕ',
};

function containsAggregate(node: ParserRuleContext): boolean {
  const t = node.getText().toUpperCase();
  return [...AGGREGATE_FUNCS].some((f) => t.includes(f + '('));
}

/**
 * Эвалит выражение на снимке. Если задан `bucket` — активны агрегаты
 * (они сворачивают bucket в одно значение).
 */
function evalNode(node: ParserRuleContext | TerminalNode, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  if (isTerminal(node)) return evalTerminal(node);

  // Колонка
  if (node instanceof ColumnContext) return evalColumn(node, snap, ctx);
  if (node instanceof MultiStringContext) return unquoteString(node.getText());
  if (node instanceof ParameterContext) {
    const name = extractParamName(node);
    if (ctx.parameters.has(name)) return ctx.parameters.get(name)!;
    ctx.warnings.add(`Параметр «&${name}» не задан — вычисления пройдут как для NULL`);
    return NULL;
  }

  // Predicate с префиксными НЕ — грамматика: `predicate: NOT* (…)`.
  // Отдельно от общего binary-fallback: там `НЕ` без пары ошибочно
  // роняло всё в UNDEFINED (issue #52).
  if (node instanceof PredicateContext) return evalPredicate(node, snap, ctx, bucket);

  // Функция (агрегат / скалярная)
  const funcResult = maybeEvalFunction(node, snap, ctx, bucket);
  if (funcResult !== NOT_A_FUNC) return funcResult;

  // Литералы
  const text = node.getText();
  const up = text.toUpperCase();
  if (up === 'ИСТИНА' || up === 'TRUE') return true;
  if (up === 'ЛОЖЬ' || up === 'FALSE') return false;
  if (up === 'NULL') return NULL;
  const asNum = numericLiteral(text);
  if (asNum !== null) return asNum;

  // Оболочки — один ребёнок
  const kids = ruleChildren(node);
  if (kids.length === 1) return evalNode(kids[0], snap, ctx, bucket);

  // Скобочная группа: LPAREN ... RPAREN
  if (kids.length >= 3 && isTerminal(kids[0]) && kids[0].getText() === '(' && isTerminal(kids[kids.length - 1]) && kids[kids.length - 1].getText() === ')') {
    // Внутри может быть одно выражение или logicalExpression
    const inner = kids.slice(1, -1).find((c) => !isTerminal(c)) as ParserRuleContext | undefined;
    if (inner) return evalNode(inner, snap, ctx, bucket);
  }

  // Бинарные операторы через среднего ребёнка
  if (kids.length === 3) {
    const opText = kids[1].getText();
    const opUpper = opText.toUpperCase();
    if (isBinaryOperator(opUpper)) {
      const l = evalNode(kids[0], snap, ctx, bucket);
      const r = evalNode(kids[2], snap, ctx, bucket);
      return applyBinary(opUpper, l, r);
    }
  }

  // Многочастные (a И b И c) — свёртка тем же оператором посередине
  if (kids.length > 3 && kids.length % 2 === 1) {
    const opText = kids[1].getText().toUpperCase();
    if (isBinaryOperator(opText)) {
      let acc = evalNode(kids[0], snap, ctx, bucket);
      for (let i = 1; i < kids.length; i += 2) {
        const op = kids[i].getText().toUpperCase();
        const r = evalNode(kids[i + 1], snap, ctx, bucket);
        acc = applyBinary(op, acc, r);
      }
      return acc;
    }
  }

  return UNDEFINED;
}

/**
 * Predicate := NOT* (booleanPredicate | likePredicate | comparePredicate | …).
 * Считаем внутренний предикат, потом применяем чётное/нечётное число НЕ.
 */
function evalPredicate(node: PredicateContext, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  const notCount = node.NOT().length;
  const inner =
    node._booleanPredicate
    ?? node.comparePredicate()
    ?? node.isNullPredicate()
    ?? node.likePredicate()
    ?? node.betweenPredicate()
    ?? node.inPredicate()
    ?? node.refsPredicate()
    ?? node.logicalExpression(); // (LPAREN logicalExpression RPAREN)
  const v = inner ? evalNode(inner, snap, ctx, bucket) : UNDEFINED;
  if (notCount % 2 === 1) return !isTruthy(v);
  return v;
}

const NOT_A_FUNC = Symbol('not-a-func');

/** Пытается распознать узел как вызов функции (агрегат или скалярную). */
function maybeEvalFunction(node: ParserRuleContext, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue | typeof NOT_A_FUNC {
  const kids = ruleChildren(node);
  if (kids.length < 3) return NOT_A_FUNC;
  // Ищем токен-имя функции + LPAREN сразу за ним
  const nameTerm = kids[0];
  const openTerm = kids[1];
  if (!isTerminal(nameTerm) || !isTerminal(openTerm)) return NOT_A_FUNC;
  if (openTerm.getText() !== '(') return NOT_A_FUNC;

  const name = nameTerm.getText().toUpperCase();
  const canonical = AGG_ALIAS[name] ?? name;

  // callParams — все children между ( и )
  const argExprs: ParserRuleContext[] = [];
  for (let i = 2; i < kids.length - 1; i += 1) {
    const k = kids[i];
    if (!isTerminal(k) && !(k as ParserRuleContext).getText().match(/^,$/)) {
      argExprs.push(k as ParserRuleContext);
    }
  }

  if (AGGREGATE_FUNCS.has(name)) {
    const b = bucket ?? [snap];
    return computeAggregate(canonical, b, argExprs[0], ctx);
  }

  // Скалярные
  const vals = argExprs.map((e) => evalNode(e, snap, ctx, bucket));
  switch (canonical) {
    case 'ГОД': case 'YEAR': return dateComp(vals[0], (d) => d.getUTCFullYear());
    case 'МЕСЯЦ': case 'MONTH': return dateComp(vals[0], (d) => d.getUTCMonth() + 1);
    case 'ДЕНЬ': case 'DAY': return dateComp(vals[0], (d) => d.getUTCDate());
    case 'ПРЕДСТАВЛЕНИЕ': case 'PRESENTATION': return toBslString(vals[0] ?? UNDEFINED);
    case 'ДАТАВРЕМЯ': case 'DATETIME': return buildDateTime(vals);
    default: return NOT_A_FUNC;
  }
}

function computeAggregate(name: string, bucket: Snap[], arg: ParserRuleContext | undefined, ctx: QueryCtx): BslValue {
  if (name === 'КОЛИЧЕСТВО') {
    if (!arg || arg.getText() === '*') return bucket.length;
    let cnt = 0;
    for (const s of bucket) {
      const v = evalNode(arg, s, ctx, null);
      if (v !== NULL && v !== UNDEFINED) cnt += 1;
    }
    return cnt;
  }
  const values: number[] = [];
  for (const s of bucket) {
    if (!arg) continue;
    const v = evalNode(arg, s, ctx, null);
    if (v === NULL || v === UNDEFINED) continue;
    const n = toNumber(v);
    if (Number.isFinite(n)) values.push(n);
  }
  if (values.length === 0) return NULL;
  switch (name) {
    case 'СУММА': return values.reduce((a, b) => a + b, 0);
    case 'СРЕДНЕЕ': return values.reduce((a, b) => a + b, 0) / values.length;
    case 'МИНИМУМ': return Math.min(...values);
    case 'МАКСИМУМ': return Math.max(...values);
    default: return NULL;
  }
}

/**
 * `ДАТАВРЕМЯ(Год, Мес, День [, Ч, М, С])` — литерал даты. Возвращаем ISO-строку
 * без часового пояса, чтобы даты сравнивались лексикографически со значениями
 * из фикстур (тоже ISO-строки без TZ).
 */
function buildDateTime(vals: BslValue[]): BslValue {
  const y = toNumber(vals[0] ?? 0);
  const m = toNumber(vals[1] ?? 1);
  const d = toNumber(vals[2] ?? 1);
  const hh = toNumber(vals[3] ?? 0);
  const mm = toNumber(vals[4] ?? 0);
  const ss = toNumber(vals[5] ?? 0);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NULL;
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function dateComp(v: BslValue, get: (d: Date) => number): BslValue {
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return get(d);
  }
  if (v instanceof Date) return get(v);
  return NULL;
}

// ── Колонки и разыменование ──────────────────────────────────────

function evalColumn(node: ColumnContext, snap: Snap, ctx: QueryCtx): BslValue {
  const idents = node.identifier();
  if (idents.length === 0) return UNDEFINED;
  const names = idents.map((i) => i.getText());
  if (names.length === 1) {
    // Ищем поле в любом источнике снимка
    for (const row of snap.values()) {
      if (names[0] in (row as Row)) return (row as Row)[names[0]] as BslValue;
    }
    // Не нашли ни в одном — предупреждаем педагога, что скорее всего опечатка
    if (snap.size > 0) ctx.warnings.add(`Поле «${names[0]}» не найдено ни в одном источнике`);
    return UNDEFINED;
  }
  // Первый — алиас источника, остальные — путь
  const [alias, ...rest] = names;
  let cur: Row | null = snap.get(alias) as Row | null;
  let path = rest;
  let tableRef = ctx.sources.get(alias);

  if (!cur) {
    // Источник можно не называть, если он один или поле однозначно:
    // «Номенклатура.Родитель» вместо «О.Номенклатура.Родитель». Так пишут
    // в условии виртуальной таблицы, где алиаса ещё нет вовсе (#59).
    for (const [srcAlias, row] of snap) {
      if (alias in (row as Row)) {
        cur = row as Row;
        tableRef = ctx.sources.get(srcAlias);
        path = names;
        break;
      }
    }
  }

  if (!cur) {
    ctx.warnings.add(`Алиас источника «${alias}» не найден`);
    return UNDEFINED;
  }
  // Первый шаг может опираться на override для виртуальных / табличных
  // источников (напр. синтетическая Ссылка табличной части — issue #49).
  let firstStep = true;
  for (let i = 0; i < path.length; i += 1) {
    if (!cur) return UNDEFINED;
    if (!(path[i] in (cur as Row))) {
      ctx.warnings.add(`Поле «${path[i]}» не найдено в «${tableRef ?? alias}»`);
      return UNDEFINED;
    }
    const val: BslValue | Row[] = (cur as Row)[path[i]];
    if (i === path.length - 1) return val as BslValue;
    // Промежуточное поле — надо разыменовать ссылку
    if (typeof val === 'string' && tableRef) {
      const overrideRefs = firstStep ? findRefsInVirtualFields(ctx, alias, path[i]) : null;
      const targetTable = overrideRefs ?? findRefsField(ctx.fx, tableRef, path[i]);
      if (!targetTable) return UNDEFINED;
      const nextRow: Row | null = ctx.fx.tables.get(targetTable)?.byRef.get(val) ?? null;
      cur = nextRow;
      tableRef = targetTable;
    } else {
      return UNDEFINED;
    }
    firstStep = false;
  }
  return UNDEFINED;
}

/** Ищет тип-ссылку в переопределённых полях источника (табличная часть, виртуальная таблица). */
function findRefsInVirtualFields(ctx: QueryCtx, alias: string, fieldName: string): string | null {
  const fields = ctx.virtualFields.get(alias);
  if (!fields) return null;
  const f = fields.find((f) => f.name === fieldName);
  if (f && f.type.kind === 'Ссылка') return f.type.refs;
  return null;
}

/** Возвращает `refs` для поля таблицы (`Справочник.Номенклатура`). */
function findRefsField(fx: Fixture, tableRef: string, fieldName: string): string | null {
  const t = fx.tables.get(tableRef)?.table;
  if (!t) return null;
  const fields = t.kind === 'Справочник' || t.kind === 'Документ' ? t.fields : [...t.dimensions, ...t.resources, ...(t.attributes ?? [])];
  const f = fields.find((f) => f.name === fieldName);
  if (f && f.type.kind === 'Ссылка') return f.type.refs;
  return null;
}

// ── Утилиты ─────────────────────────────────────────────────────────

function evalTerminal(t: TerminalNode): BslValue {
  const txt = t.getText();
  const up = txt.toUpperCase();
  if (up === 'ИСТИНА' || up === 'TRUE') return true;
  if (up === 'ЛОЖЬ' || up === 'FALSE') return false;
  if (up === 'NULL') return NULL;
  const asNum = numericLiteral(txt);
  if (asNum !== null) return asNum;
  return txt;
}

function isTerminal(n: unknown): n is TerminalNode {
  return !!n && typeof (n as { symbol?: unknown }).symbol === 'object';
}

function ruleChildren(node: ParserRuleContext): (ParserRuleContext | TerminalNode)[] {
  const out: (ParserRuleContext | TerminalNode)[] = [];
  const count = node.getChildCount();
  for (let i = 0; i < count; i += 1) {
    const c = node.getChild(i);
    if (c) out.push(c as ParserRuleContext | TerminalNode);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findFirst<T extends ParserRuleContext>(node: ParserRuleContext, Ctor: new (...a: any[]) => T): T | null {
  const stack: (ParserRuleContext | TerminalNode)[] = [...ruleChildren(node)];
  while (stack.length) {
    const cur = stack.shift()!;
    if (isTerminal(cur)) continue;
    if (cur instanceof Ctor) return cur as T;
    stack.push(...ruleChildren(cur as ParserRuleContext));
  }
  return null;
}

function unquoteString(s: string): string {
  if (s.startsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
  return s;
}

function numericLiteral(s: string): number | null {
  if (!/^-?\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isBinaryOperator(op: string): boolean {
  return [
    '+', '-', '*', '/',
    '=', '<>', '!=', '<', '>', '<=', '>=',
    'И', 'AND', 'ИЛИ', 'OR',
  ].includes(op);
}

function applyBinary(op: string, l: BslValue, r: BslValue): BslValue {
  switch (op) {
    case '+': return num(l) + num(r);
    case '-': return num(l) - num(r);
    case '*': return num(l) * num(r);
    case '/': return num(l) / num(r);
    case '=': return valuesEqual(l, r);
    case '<>': case '!=': return !valuesEqual(l, r);
    case '<': return cmp(l, r) < 0;
    case '>': return cmp(l, r) > 0;
    case '<=': return cmp(l, r) <= 0;
    case '>=': return cmp(l, r) >= 0;
    case 'И': case 'AND': return isTruthy(l) && isTruthy(r);
    case 'ИЛИ': case 'OR': return isTruthy(l) || isTruthy(r);
    default: return NULL;
  }
}

function num(v: BslValue): number { return typeof v === 'number' ? v : toNumber(v); }
function cmp(l: BslValue, r: BslValue): number { return compareValues(l, r) ?? 0; }

// ── Alias / mdo helpers ──────────────────────────────────────────

function readAlias(node: ParserRuleContext): string | null {
  // Ищем прямой AliasContext-ребёнок и берём его identifier (не токен КАК!).
  // Через instanceof, а не constructor.name — минификатор prod-сборки
  // переименовывает имена классов, но instanceof остаётся стабильным.
  const child = ruleChildren(node).find((c) => !isTerminal(c) && c instanceof AliasContext) as AliasContext | undefined;
  if (!child) return null;
  const ident = findFirst(child, IdentifierContext);
  return ident?.getText() ?? null;
}

function mdoRef(mdo: MdoContext): string {
  const parts: string[] = [];
  for (const c of ruleChildren(mdo)) {
    if (isTerminal(c)) {
      const t = c.getText();
      if (t === '.' || t === ',' || t === '(' || t === ')') continue;
      parts.push(t);
    } else if (c instanceof IdentifierContext) {
      parts.push(c.getText());
    }
  }
  return parts.join('.');
}

function joinKind(j: JoinPartContext): 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' {
  const t = j.getText().toUpperCase();
  if (t.includes('LEFT') || t.includes('ЛЕВОЕ')) return 'LEFT';
  if (t.includes('RIGHT') || t.includes('ПРАВОЕ')) return 'RIGHT';
  if (t.includes('FULL') || t.includes('ПОЛНОЕ')) return 'FULL';
  return 'INNER';
}
