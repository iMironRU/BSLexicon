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
import { fieldsOf, type Fixture, type Row } from './fixture';
import {
  AliasContext,
  BetweenPredicateContext,
  CaseExpressionContext,
  CastFunctionContext,
  ColumnContext,
  ComparePredicateContext,
  DataSourceContext,
  ExpressionContext,
  IdentifierContext,
  InPredicateContext,
  IsNullPredicateContext,
  JoinPartContext,
  LikePredicateContext,
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
  UnaryExpressionContext,
  VirtualTableContext,
} from './parser/generated/SDBLParser';
import { materializeVirtual, type VirtualMethod } from './virtual-tables';
import { aggregateFuncOf, applyTotals } from './totals';
import type { Field } from './types';
import { extractParamName } from './parameters';

// ── Публичный API ──────────────────────────────────────────────────

export interface Rowset {
  columns: string[];
  rows: BslValue[][];
  /**
   * Уровень каждой строки для ИТОГИ (issue #45): 0 — детальная строка,
   * 1+ — итог по N-й группе (1 = самая внешняя). Пусто, если ИТОГИ
   * не запрашивались.
   */
  rowLevels?: number[];
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
  /** Временные таблицы (issue #46), доступные запросу. Ключ — имя ВТ. */
  tempTables?: Map<string, Rowset>;
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

  // Пакет живёт с общим набором временных таблиц (#46).
  const tempTables = new Map<string, Rowset>(options.tempTables ?? []);
  const pkgOptions: RunOptions = { ...options, tempTables };
  const warnings: string[] = [];
  let lastResult: ExecResult | null = null;

  for (const q of queries) {
    const dropQ = q.dropTableQuery();
    if (dropQ) {
      const name = dropQ._temporaryTableName?.getText();
      if (name && !tempTables.delete(name)) {
        warnings.push(`Не удалось УНИЧТОЖИТЬ «${name}» — такой временной таблицы нет`);
      }
      continue;
    }
    const sel = q.selectQuery();
    if (!sel) throw new QueryRuntimeError('Ожидался ВЫБРАТЬ или УНИЧТОЖИТЬ');
    const res = execSelectQuery(sel, fx, pkgOptions);
    for (const w of res.warnings) warnings.push(w);

    const main = sel.subquery()?._main;
    const tempName = main?.temporaryTableIdentifier?.()?.getText();
    if (tempName) {
      tempTables.set(tempName, res.rowset);
    } else {
      lastResult = res;
    }
  }

  if (!lastResult) {
    throw new QueryRuntimeError('Пакет запросов не содержит финального ВЫБРАТЬ (только ПОМЕСТИТЬ/УНИЧТОЖИТЬ)');
  }
  return { rowset: lastResult.rowset, warnings };
}

function execSelectQuery(node: SelectQueryContext, fx: Fixture, options: RunOptions): ExecResult {
  const sub = node.subquery() as SubqueryContext | null;
  if (!sub) throw new QueryRuntimeError('Пустой SELECT');
  const main = sub._main;
  if (!main) throw new QueryRuntimeError('Отсутствует основная часть SELECT');
  // ПОМЕСТИТЬ ВТ_Имя обрабатывается на уровне пакета — execPackage
  // положит результат в ctx.tempTables (см. #46).

  const { rowset, warnings, aggregates, grouped } = execQuery(main, fx, options);
  finalizeSubquery(sub, rowset, warnings, fx, options, node._orders);

  // ИТОГИ ПО — последним шагом, поверх отсортированного результата: итоговая
  // строка встаёт над своими подробностями, общий итог — первым (#45).
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
    rowset.rowLevels = levels;
    return { rowset, warnings: [...warnings, ...extra] };
  }

  return { rowset, warnings };
}

/**
 * Пост-обработка subquery: РАЗЛИЧНЫЕ → ОБЪЕДИНИТЬ → УПОРЯДОЧИТЬ → ПЕРВЫЕ N.
 *
 * Общий хвост для обоих путей исполнения: верхнеуровневого `SELECT`
 * (в `execSelectQuery`) и `ИЗ (…) КАК Т` (в `readSubquerySource`). До
 * этого fix'а FROM-подзапрос шёл мимо, из-за чего `ПЕРВЫЕ N`,
 * `УПОРЯДОЧИТЬ ПО` и `ОБЪЕДИНИТЬ` внутри него игнорировались (#68).
 *
 * `outerOrderBy` — `_orders` из внешнего SelectQuery (стоит после
 * ИТОГИ ПО): для FROM-подзапроса его нет.
 */
function finalizeSubquery(
  sub: SubqueryContext,
  rowset: Rowset,
  warnings: string[],
  fx: Fixture,
  options: RunOptions,
  outerOrderBy?: OrderByContext | null,
): void {
  const main = sub._main;
  if (!main) return;

  const lim = main.limitations();
  if (lim?.DISTINCT()) rowset.rows = dedupeRows(rowset.rows);

  // ОБЪЕДИНИТЬ / ОБЪЕДИНИТЬ ВСЕ — каждая union-часть выполняется отдельно,
  // строки склеиваются с основной. `ОБЪЕДИНИТЬ` без ВСЕ дедуплицирует
  // финальный набор; `ОБЪЕДИНИТЬ ВСЕ` — сохраняет дубли.
  const unions = sub._unions ?? [];
  let anyDedupe = false;
  for (const u of unions) {
    const partRes = execQuery(u.query(), fx, options);
    for (const w of partRes.warnings) warnings.push(w);
    if (partRes.rowset.columns.length !== rowset.columns.length) {
      throw new QueryRuntimeError(
        `ОБЪЕДИНИТЬ: число колонок не совпадает (${partRes.rowset.columns.length} vs ${rowset.columns.length}).`,
      );
    }
    for (const r of partRes.rowset.rows) rowset.rows.push(r);
    if (!u.UNION_ALL()) anyDedupe = true;
  }
  if (anyDedupe) rowset.rows = dedupeRows(rowset.rows);

  // ORDER BY может быть либо в subquery (стандартное место), либо на
  // уровне selectQuery (после ИТОГИ / АВТОУПОРЯДОЧИВАНИЕ).
  const orderBy = outerOrderBy ?? sub.orderBy?.();
  if (orderBy) applyOrderBy(rowset, orderBy);

  // ПЕРВЫЕ N — после сортировки, чтобы взять «первые N по УПОРЯДОЧИТЬ».
  const topN = lim?.top()?._count?.text;
  if (topN) {
    const n = Number(topN);
    if (Number.isFinite(n) && n >= 0) rowset.rows = rowset.rows.slice(0, n);
  }
}

/** Дедупликация Rowset по всем колонкам. Порядок сохраняем (стабильный). */
function dedupeRows(rows: BslValue[][]): BslValue[][] {
  const seen = new Set<string>();
  const out: BslValue[][] = [];
  for (const row of rows) {
    const key = row.map((v) => rowKey(v)).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function rowKey(v: BslValue): string {
  if (v === NULL) return '\0N';
  if (v === UNDEFINED) return '\0U';
  if (typeof v === 'boolean') return v ? '\0T' : '\0F';
  if (typeof v === 'number') return `n${v}`;
  if (typeof v === 'string') return `s${v}`;
  return JSON.stringify(v);
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
  /**
   * Временные таблицы, доступные из этого запроса — заполняются на уровне
   * пакета (issue #46). Ключ — имя ВТ (без префикса).
   */
  tempTables: Map<string, Rowset>;
  /** Собранные warning'и: неизвестные поля, битые ссылки. */
  warnings: Set<string>;
}

/** Одна «строка-снимок»: алиас → Row исходной таблицы. */
type Snap = Map<string, Row>;

function execQuery(q: QueryContext, fx: Fixture, options: RunOptions): ExecResult {
  const params = new Map<string, BslValue>();
  for (const [k, v] of Object.entries(options.parameters ?? {})) params.set(k, v);
  const ctx: QueryCtx = {
    fx,
    sources: new Map(),
    virtualFields: new Map(),
    parameters: params,
    tempTables: options.tempTables ?? new Map(),
    warnings: new Set(),
  };

  // FROM
  const snaps: Snap[] = q._from_ ? collectDataSources(q._from_.dataSource(), ctx) : [new Map()];

  // WHERE
  const filtered = q._where ? snaps.filter((s) => isTruthy(evalNode(q._where!, s, ctx, null))) : snaps;

  // SELECT
  const columnSpecs = collectSelectedFields(q, ctx);

  // GROUP BY / HAVING / агрегаты
  const groupExprs = q._groupBy ?? [];
  const hasAgg = columnSpecs.some((c) => c.kind === 'expr' && containsAggregate(c.expr));

  let detailRows: BslValue[][];
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
    detailRows = [];
    for (const bucket of groups.values()) {
      if (q._having && !isTruthy(evalNode(q._having, bucket[0] ?? new Map(), ctx, bucket))) continue;
      detailRows.push(columnSpecs.map((c) => evalOutputColumn(c, bucket[0] ?? new Map(), ctx, bucket)));
    }
  } else {
    detailRows = filtered.map((s) => columnSpecs.map((c) => evalOutputColumn(c, s, ctx, null)));
  }

  const columnNames = columnSpecs.map((c) => c.name);
  const rowset: Rowset = { columns: columnNames, rows: detailRows };

  return {
    rowset,
    warnings: [...ctx.warnings],
    aggregates: aggregateColumns(columnSpecs),
    grouped: groupExprs.length > 0 || hasAgg,
  };
}

/** Колонки выборки, которые сами по себе агрегат: их и складывают ИТОГИ без списка функций. */
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
    // alias находится в DataSourceContext (sibling с table), не в TableContext
    const alias = readAlias(ds);
    let snaps: Snap[];
    const sq = ds.subquery?.();
    const vt = ds.virtualTable?.();
    if (sq) {
      snaps = readSubquerySource(sq, ctx, alias);
    } else if (vt) {
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

/**
 * `ИЗ (ВЫБРАТЬ …) КАК Т` — прогоняем подзапрос как самостоятельный,
 * материализуем результат в набор строк с полями по именам колонок.
 * Разыменование через точку в подзапросе не поддерживаем — типов
 * колонок нет (типизацию можно добить в отдельной задаче).
 */
function readSubquerySource(sub: SubqueryContext, ctx: QueryCtx, aliasOverride?: string | null): Snap[] {
  const main = sub._main;
  if (!main) throw new QueryRuntimeError('Пустой подзапрос в ИЗ');
  const options = buildOptionsFromCtx(ctx);
  const nested = execQuery(main, ctx.fx, options);
  // РАЗЛИЧНЫЕ / ОБЪЕДИНИТЬ / УПОРЯДОЧИТЬ ПО / ПЕРВЫЕ N внутри подзапроса
  // применяются здесь — раньше эта ветка шла мимо и брала все строки (#68).
  finalizeSubquery(sub, nested.rowset, nested.warnings, ctx.fx, options);
  const alias = aliasOverride ?? '_sub';
  // Складываем warning'и подзапроса к внешним, чтобы UI их всё-таки показал.
  for (const w of nested.warnings) ctx.warnings.add(w);
  const snaps: Snap[] = nested.rowset.rows.map((row) => {
    const r: Row = {};
    nested.rowset.columns.forEach((col, i) => { r[col] = row[i]; });
    return new Map([[alias, r]]) as Snap;
  });
  ctx.sources.set(alias, alias);
  // Регистрируем виртуальные поля — по именам колонок; тип пока Строка
  // (для asterisk и наличия поля этого достаточно, деref не работает).
  ctx.virtualFields.set(alias, nested.rowset.columns.map((c) => ({ name: c, type: { kind: 'Строка' } })));
  return snaps;
}

/** Собирает RunOptions из текущего ctx — для вложенных запросов. */
function buildOptionsFromCtx(ctx: QueryCtx): RunOptions {
  const parameters: { [name: string]: BslValue } = {};
  for (const [k, v] of ctx.parameters) parameters[k] = v;
  return { parameters, tempTables: ctx.tempTables };
}

function readTable(table: TableContext, ctx: QueryCtx, aliasOverride?: string | null): Snap[] {
  const mdo = table.mdo();
  if (!mdo) {
    // Возможно это временная таблица — `ИЗ ВТ_Имя КАК Т` (#46).
    const tableName = table._tableName?.getText();
    if (tableName) return readTempTable(tableName, ctx, aliasOverride);
    throw new QueryRuntimeError('Источник не является объектом метаданных');
  }

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

/** `ИЗ ВТ_Имя` — материализация временной таблицы (#46). */
function readTempTable(name: string, ctx: QueryCtx, aliasOverride?: string | null): Snap[] {
  const rs = ctx.tempTables.get(name);
  if (!rs) throw new QueryRuntimeError(`Временная таблица «${name}» не создана — нужен ВЫБРАТЬ … ПОМЕСТИТЬ ${name} до этого запроса.`);
  const alias = aliasOverride ?? name;
  ctx.sources.set(alias, name);
  // Регистрируем поля ВТ по именам колонок (типы теряются — как в реальной 1С,
  // где явная типизация через ВЫРАЗИТЬ КАК Тип идёт на будущее).
  ctx.virtualFields.set(alias, rs.columns.map((c) => ({ name: c, type: { kind: 'Строка' as const } })));
  return rs.rows.map((r) => {
    const row: Row = {};
    rs.columns.forEach((c, i) => { row[c] = r[i]; });
    return new Map([[alias, row]]) as Snap;
  });
}

function readVirtualTable(vt: VirtualTableContext, ctx: QueryCtx, aliasOverride?: string | null): Snap[] {
  const mdo = vt.mdo();
  if (!mdo) throw new QueryRuntimeError('Виртуальная таблица без объекта метаданных');
  const ref = mdoRef(mdo);
  const tf = ctx.fx.tables.get(ref);
  if (!tf) throw new QueryRuntimeError(`Регистр «${ref}» не найден в схеме`);
  const method = virtualMethod(vt);

  if (method === 'Остатки' || method === 'Обороты' || method === 'ОстаткиИОбороты') {
    if (tf.table.kind !== 'РегистрНакопления') {
      throw new QueryRuntimeError(`«${ref}» — ${tf.table.kind}. .${method} — только для регистров накопления.`);
    }
    // .Остатки и .ОстаткиИОбороты живут только у регистра остатков (в справке
    // 1С прямо: «Таблица существует только для регистров остатков»). .Обороты —
    // у обоих видов (см. #51).
    if ((method === 'Остатки' || method === 'ОстаткиИОбороты') && tf.table.view !== 'Остатки') {
      throw new QueryRuntimeError(
        `Регистр «${ref}» — оборотный (view: 'Обороты'). ` +
        `Виртуальная ${method} доступна только для регистров остатков; используй .Обороты.`,
      );
    }
  } else if (method === 'СрезПоследних' || method === 'СрезПервых') {
    if (tf.table.kind !== 'РегистрСведений') {
      throw new QueryRuntimeError(`«${ref}» — ${tf.table.kind}. .${method} — только для регистров сведений.`);
    }
    if (!tf.table.periodic) {
      throw new QueryRuntimeError(`Регистр «${ref}» непериодический — виртуальная .${method} не имеет смысла.`);
    }
  }

  const { values, condition } = collectVirtualParams(vt, method, ctx, ref);
  const materialized = materializeVirtual(ctx.fx, { ref, method, params: values, condition });

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
  if (vt.SLICELAST_VT()) return 'СрезПоследних';
  if (vt.SLICEFIRST_VT()) return 'СрезПервых';
  if (vt.BOUNDARIES_VT()) throw new QueryRuntimeError('Границы пока не реализованы');
  throw new QueryRuntimeError('Неизвестный тип виртуальной таблицы');
}

function collectVirtualParams(
  vt: VirtualTableContext,
  method: VirtualMethod,
  ctx: QueryCtx,
  registerRef: string,
): {
  values: BslValue[];
  condition: import('./virtual-tables').VirtualCondition | undefined;
} {
  const raw = vt.virtualTableParameter();
  const list = Array.isArray(raw) ? raw : [];
  // Позиция «условия» зависит от метода (issue #59):
  //   Остатки(Период, Условие) — 2-й
  //   СрезПоследних/СрезПервых(Период, Условие) — 2-й
  //   Обороты/ОстаткиИОбороты(Начало, Конец, Периодичность, Условие) — 4-й
  // Пользователь может опустить хвост; условие — последний непустой параметр,
  // но по позиции. Ниже — жёсткое соответствие индекса методу.
  const conditionIdx =
    method === 'Обороты' || method === 'ОстаткиИОбороты' ? 3 : 1;

  const values: BslValue[] = [];
  let condition: import('./virtual-tables').VirtualCondition | undefined;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    const expr = p.logicalExpression();
    if (i === conditionIdx) {
      if (expr) {
        // Замыкание: интерпретатор применит выражение к каждой строке
        // регистра при агрегации. Alias «Регистр» условно __vt__; поля
        // без префикса ловятся через evalColumn (первый source в snap).
        // Регистрируем __vt__ → регистр в ctx.sources, чтобы разыменование
        // (`Номенклатура.Родитель` в условии — #65) знало таблицу-источник.
        const conditionExpr = expr;
        condition = (row: Row): boolean => {
          const prev = ctx.sources.get(VT_INTERNAL_ALIAS);
          ctx.sources.set(VT_INTERNAL_ALIAS, registerRef);
          try {
            const snap: Snap = new Map([[VT_INTERNAL_ALIAS, row]]);
            return isTruthy(evalNode(conditionExpr, snap, ctx, null));
          } finally {
            if (prev === undefined) ctx.sources.delete(VT_INTERNAL_ALIAS);
            else ctx.sources.set(VT_INTERNAL_ALIAS, prev);
          }
        };
      }
      continue;
    }
    if (!expr) {
      values.push(UNDEFINED);
      continue;
    }
    if (looksLikeCondition(expr.getText())) {
      throw new QueryRuntimeError(
        `Условие отбора в виртуальной таблице стоит последним параметром. ` +
        `Для ${method} это ${conditionIdx + 1}-й: ${signatureHint(method)}. ` +
        `Пропущенные параметры оставляют пустыми: ${exampleHint(method)}`,
      );
    }
    values.push(evalNode(expr, new Map(), ctx, null));
  }
  return { values, condition };
}

const VT_INTERNAL_ALIAS = '__vt__';

/** Похоже ли выражение на условие отбора, а не на значение параметра. */
function looksLikeCondition(text: string): boolean {
  return /(<>|>=|<=|=|>|<)|\bПОДОБНО\b|\bМЕЖДУ\b|\bЕСТЬ\b|\bВ\s+ИЕРАРХИИ\b/i.test(text);
}

function signatureHint(method: VirtualMethod): string {
  switch (method) {
    case 'Обороты': return 'Обороты(Начало, Конец, Периодичность, Условие)';
    case 'ОстаткиИОбороты': return 'ОстаткиИОбороты(Начало, Конец, Периодичность, Условие)';
    default: return `${method}(Период, Условие)`;
  }
}

function exampleHint(method: VirtualMethod): string {
  switch (method) {
    case 'Обороты':
    case 'ОстаткиИОбороты':
      return `${method}(&Начало, &Конец, , Склад = &Склад)`;
    default:
      return `${method}(, Склад = &Склад)`;
  }
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
      fields = fieldsOf(table);
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
  // Сортируем сцепку (row, level) чтобы rowLevels остались синхронны с rows.
  const pairs = rowset.rows.map((row, i) => ({ row, level: rowset.rowLevels?.[i] ?? 0 }));
  pairs.sort((a, b) => {
    for (const s of specs) {
      const i = idx.get(s.colName);
      if (i === undefined) continue;
      const c = compareValues(a.row[i], b.row[i]);
      if (c === undefined) continue;
      if (c !== 0) return s.dir * c;
    }
    return 0;
  });
  rowset.rows = pairs.map((p) => p.row);
  if (rowset.rowLevels) rowset.rowLevels = pairs.map((p) => p.level);
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
  if (node instanceof IsNullPredicateContext) return evalIsNull(node, snap, ctx, bucket);
  if (node instanceof BetweenPredicateContext) return evalBetween(node, snap, ctx, bucket);
  if (node instanceof InPredicateContext) return evalIn(node, snap, ctx, bucket);
  if (node instanceof LikePredicateContext) return evalLike(node, snap, ctx, bucket);
  if (node instanceof CaseExpressionContext) return evalCase(node, snap, ctx, bucket);
  if (node instanceof ComparePredicateContext) return evalCompare(node, snap, ctx, bucket);
  if (node instanceof CastFunctionContext) return evalCast(node, snap, ctx, bucket);

  // Унарный ±: `sign expression` (#72). Без этого кейса fallback ловит только
  // `-<число>` через `getText()`-регэксп («-5»), а `-Поле`/`-СУММА(x)`/`-(a+b)`
  // молча падают в UNDEFINED. Семантика — как у binary `0 ± X`.
  if (node instanceof UnaryExpressionContext) {
    const inner = evalNode(node.expression(), snap, ctx, bucket);
    const op = node.sign().getText();
    return op === '-' ? applyBinary('-', 0, inner) : num(inner);
  }

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

/** ЕСТЬ NULL / ЕСТЬ НЕ NULL — проверка на NULL/UNDEFINED. */
function evalIsNull(node: IsNullPredicateContext, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  const v = evalNode(node.expression(), snap, ctx, bucket);
  const isNull = v === NULL || v === UNDEFINED;
  return node.NOT() ? !isNull : isNull;
}

/** МЕЖДУ x И y — включительно с обеих сторон. */
function evalBetween(node: BetweenPredicateContext, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  const exprs = node.expression();
  if (!exprs || exprs.length < 3) return NULL;
  const v = evalNode(exprs[0], snap, ctx, bucket);
  const lo = evalNode(exprs[1], snap, ctx, bucket);
  const hi = evalNode(exprs[2], snap, ctx, bucket);
  const cmpLo = compareValues(v, lo);
  const cmpHi = compareValues(v, hi);
  if (cmpLo === undefined || cmpHi === undefined) return NULL;
  return cmpLo >= 0 && cmpHi <= 0;
}

/**
 * `<expr> В (a, b, c)` — членство в списке. `[НЕ] В` через NOT-цепочку.
 * `<expr> В ИЕРАРХИИ (a)` — принадлежит поддереву a (обход Родитель).
 * Подзапросы в списке пока не поддерживаем (#39).
 */
function evalIn(node: InPredicateContext, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  const isHierarchy = !!node.IN_HIERARCHY();
  const notCount = node.NOT().length;
  const invert = notCount % 2 === 1;

  const scalar = node.expression();
  if (!scalar) return NULL;
  const v = evalNode(scalar, snap, ctx, bucket);
  if (v === NULL || v === UNDEFINED) return invert ? true : false;

  const inSub = node.subquery();
  if (inSub) {
    const nested = execQuery(inSub._main!, ctx.fx, buildOptionsFromCtx(ctx));
    for (const w of nested.warnings) ctx.warnings.add(w);
    // Берём первую колонку каждой строки как элемент списка.
    const items: BslValue[] = nested.rowset.rows.map((r) => r[0]);
    const has = items.some((it) => valuesEqual(v, it));
    return invert ? !has : has;
  }

  const lists = node.expressionList();
  const list = Array.isArray(lists) ? lists[0] : lists;
  const items: BslValue[] = [];
  if (list) {
    for (const it of list.expressionListItem?.() ?? []) {
      const expr = it.expression?.();
      if (expr) items.push(evalNode(expr, snap, ctx, bucket));
    }
  }

  if (isHierarchy) {
    return applyInHierarchy(v, items, ctx, invert);
  }

  const has = items.some((it) => valuesEqual(v, it));
  return invert ? !has : has;
}

/**
 * Обход Родитель-цепочки: v принадлежит поддереву кого-то из items, если
 * сам v или любой предок совпадает с одним из them.
 */
function applyInHierarchy(v: BslValue, items: BslValue[], ctx: QueryCtx, invert: boolean): boolean {
  if (typeof v !== 'string' || items.length === 0) return invert;
  const targets = new Set(items.filter((x) => typeof x === 'string') as string[]);
  // Ищем таблицу-владелец: сначала по v, если не нашли — по первому target
  // (v может быть уже мимо любой таблицы, но target ссылается на группу).
  let ownerRef: string | null = null;
  for (const [ref, tf] of ctx.fx.tables) {
    if (tf.byRef.has(v)) { ownerRef = ref; break; }
  }
  if (!ownerRef) {
    for (const [ref, tf] of ctx.fx.tables) {
      for (const t of targets) if (tf.byRef.has(t)) { ownerRef = ref; break; }
      if (ownerRef) break;
    }
  }
  if (!ownerRef) return invert;
  const tableInfo = ctx.fx.tables.get(ownerRef)!;
  if (tableInfo.table.kind === 'Справочник' && !tableInfo.table.hierarchical) {
    throw new QueryRuntimeError(
      `В ИЕРАРХИИ не применимо к «${ownerRef}» — справочник не иерархический.`,
    );
  }
  const table = tableInfo;
  let cur = v;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (targets.has(cur)) return !invert;
    const row = table.byRef.get(cur);
    if (!row) break;
    const parent = row['Родитель'];
    if (typeof parent !== 'string' || !parent) break;
    cur = parent;
  }
  return invert;
}

/** ПОДОБНО «pattern» — SQL LIKE. `%` → любая подстрока, `_` → любой один символ. */
function evalLike(node: LikePredicateContext, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  const exprs = node.expression();
  if (!exprs || exprs.length < 2) return NULL;
  const notCount = node.NOT().length;
  const invert = notCount % 2 === 1;
  const v = evalNode(exprs[0], snap, ctx, bucket);
  const pat = evalNode(exprs[1], snap, ctx, bucket);
  if (typeof v !== 'string' || typeof pat !== 'string') return NULL;
  const esc = node._escape ? unquoteString(node._escape.getText()) : null;
  const re = likeToRegExp(pat, esc);
  const match = re.test(v);
  return invert ? !match : match;
}

function likeToRegExp(pattern: string, escape: string | null): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (escape && c === escape && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      out += next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
      continue;
    }
    if (c === '%') out += '.*';
    else if (c === '_') out += '.';
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  out += '$';
  return new RegExp(out, 'is');
}

/** ВЫБОР КОГДА … ТОГДА … ИНАЧЕ … КОНЕЦ — CASE. */
function evalCase(node: CaseExpressionContext, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  // Форма «ВЫБОР <expr> КОГДА <v1> ТОГДА <r1> …» — сравниваем expr со значениями каждого КОГДА.
  const primary = node._caseExp ? evalNode(node._caseExp, snap, ctx, bucket) : null;
  for (const b of node.caseBranch()) {
    const branchExprs = b.logicalExpression();
    const conds = Array.isArray(branchExprs) ? branchExprs : [branchExprs];
    if (conds.length < 2) continue;
    // conds[0] = условие/значение КОГДА, conds[1] = результат ТОГДА
    const whenVal = evalNode(conds[0], snap, ctx, bucket);
    let matched: boolean;
    if (primary !== null) {
      matched = valuesEqual(primary, whenVal);
    } else {
      matched = isTruthy(whenVal);
    }
    if (matched) return evalNode(conds[1], snap, ctx, bucket);
  }
  if (node._elseExp) return evalNode(node._elseExp, snap, ctx, bucket);
  return NULL;
}

/** ComparePredicate: `expr op expr`. Дублирует общий fallback, но безопасен для вложенности в PredicateContext. */
function evalCompare(node: ComparePredicateContext, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  const exprs = node.expression();
  if (!exprs || exprs.length < 2) return NULL;
  const op = node._compareOperation?.text ?? '=';
  const l = evalNode(exprs[0], snap, ctx, bucket);
  const r = evalNode(exprs[1], snap, ctx, bucket);
  return applyBinary(op, l, r);
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
    case 'ЕСТЬNULL': case 'ISNULL': {
      // ЕСТЬNULL(x, y) — если x равен NULL/UNDEFINED, вернёт y, иначе x.
      const v = vals[0];
      return v === NULL || v === UNDEFINED ? (vals[1] ?? NULL) : v;
    }
    case 'ПОДСТРОКА': case 'SUBSTRING': {
      // ПОДСТРОКА(строка, начало, длина) — индексация с 1 (как в 1С),
      // отрицательные / нечисловые аргументы → NULL.
      const v = vals[0];
      if (v === NULL || v === UNDEFINED) return NULL;
      const s = toBslString(v);
      const start = toNumber(vals[1]);
      const len = toNumber(vals[2]);
      if (!Number.isFinite(start) || !Number.isFinite(len)) return NULL;
      const from = Math.max(0, Math.trunc(start) - 1);
      return s.substring(from, from + Math.max(0, Math.trunc(len)));
    }
    default: return NOT_A_FUNC;
  }
}

/**
 * ВЫРАЗИТЬ(expr КАК Тип) — приведение типа (#69). Правила близки к
 * платформе: если значение уже нужного типа — возвращается оно
 * (со срезкой строки до длины); если нет — `NULL`. Приведение к
 * ссылочному типу метаданных пока не реализовано — возвращает NULL
 * с warning'ом (внятнее тихой пустоты).
 */
function evalCast(node: CastFunctionContext, snap: Snap, ctx: QueryCtx, bucket: Snap[] | null): BslValue {
  const expr = node._value;
  if (!expr) return NULL;
  const v = evalNode(expr, snap, ctx, bucket);
  if (v === NULL || v === UNDEFINED) return NULL;

  if (node.STRING()) {
    const s = toBslString(v);
    const lenText = node._len?.text;
    if (lenText) {
      const n = Number(lenText);
      if (Number.isFinite(n) && n >= 0) return s.slice(0, n);
    }
    return s;
  }
  if (node.NUMBER()) {
    const n = toNumber(v);
    if (!Number.isFinite(n)) return NULL;
    const precText = node._prec?.text;
    if (precText) {
      const p = Number(precText);
      if (Number.isFinite(p) && p >= 0) {
        const mult = Math.pow(10, p);
        return Math.round(n * mult) / mult;
      }
    }
    // ЧИСЛО без указания дробной части — целочисленное приведение.
    if (node._len) return Math.trunc(n);
    return n;
  }
  if (node.BOOLEAN()) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return NULL;
  }
  if (node.DATE()) {
    // Даты в интерпретаторе — ISO-строки (`buildDateTime`). Всё, что не
    // выглядит как ISO — не дата в этом рантайме.
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v;
    return NULL;
  }
  if (node.mdo()) {
    ctx.warnings.add('ВЫРАЗИТЬ КАК ссылка на метаданные пока не реализовано — возвращаю NULL');
    return NULL;
  }
  return NULL;
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
    // В источнике поле объявлено, но в снимке его нет — типичная строка без пары
    // в ЛЕВОМ СОЕДИНЕНИИ: правая сторона пуста, читаем поле → NULL, но без
    // предупреждения (#73). Ошибочная опечатка — только если ни в одном источнике
    // поле вообще не объявлено.
    if (snap.size > 0) {
      if (isDeclaredInAnySource(ctx, names[0])) return NULL;
      ctx.warnings.add(`Поле «${names[0]}» не найдено ни в одном источнике`);
    }
    return UNDEFINED;
  }
  // Первый — алиас источника, остальные — путь.
  // Если первый — не алиас (нет такого источника в snap), пробуем
  // трактовать как поле любого источника: `Товар.Родитель` вместо
  // `Т.Товар.Родитель` — короткая запись, живёт в условиях виртуальных
  // таблиц и в тексте без алиасов (issue #65).
  let alias: string;
  let path: string[];
  let cur: Row | null;
  let tableRef: string | undefined;

  const maybeAlias = names[0];
  const asAliasRow = snap.get(maybeAlias) as Row | null | undefined;
  if (asAliasRow) {
    alias = maybeAlias;
    path = names.slice(1);
    cur = asAliasRow;
    tableRef = ctx.sources.get(alias);
  } else {
    // Пробуем маркировать как поле: ищем первый источник, где есть такое поле.
    let foundAlias: string | null = null;
    let foundRow: Row | null = null;
    for (const [aliasKey, row] of snap) {
      if (names[0] in (row as Row)) { foundAlias = aliasKey; foundRow = row as Row; break; }
    }
    if (!foundAlias) {
      ctx.warnings.add(`Поле или алиас «${maybeAlias}» не найдено ни в одном источнике`);
      return UNDEFINED;
    }
    alias = foundAlias;
    path = names.slice(0); // включая первое имя (это поле, не алиас)
    cur = foundRow;
    tableRef = ctx.sources.get(alias);
  }
  // Первый шаг может опираться на override для виртуальных / табличных
  // источников (напр. синтетическая Ссылка табличной части — issue #49).
  let firstStep = true;
  for (let i = 0; i < path.length; i += 1) {
    if (!cur) return UNDEFINED;
    if (!(path[i] in (cur as Row))) {
      // Строка без пары в ЛЕВОМ СОЕДИНЕНИИ (#73): правый источник в снимке
      // присутствует, но Row пустой — читаем объявленное поле как NULL, без
      // ложного предупреждения. Работает для подзапросов и виртуальных таблиц
      // (их колонки лежат в ctx.virtualFields), обычных таблиц (в схеме) и
      // для промежуточной точки после разыменования (фолбэк на схему цели).
      if (isDeclaredForAlias(ctx, alias, tableRef, path[i], i === 0)) return NULL;
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

/**
 * `Поле` объявлено в источнике под данным алиасом (виртуальные / табличные
 * колонки, либо схема реальной таблицы). Нужно для #73: у строки без пары
 * в ЛЕВОМ СОЕДИНЕНИИ в Snap лежит пустой Row правого источника — читаем
 * поле → NULL без предупреждения.
 *
 * `useVirtualFields` — для первого шага пути (i=0) смотрим virtualFields
 * по алиасу; для промежуточной точки (после разыменования) алиас уже не
 * соответствует источнику, там опираемся только на схему цели (`tableRef`).
 */
function isDeclaredForAlias(ctx: QueryCtx, alias: string, tableRef: string | undefined, name: string, useVirtualFields: boolean): boolean {
  if (useVirtualFields) {
    const virt = ctx.virtualFields.get(alias);
    if (virt?.some((f) => f.name === name)) return true;
  }
  if (tableRef) {
    const t = ctx.fx.tables.get(tableRef)?.table;
    if (t && fieldsOf(t).some((f) => f.name === name)) return true;
  }
  return false;
}

/** Поле объявлено хотя бы в одном источнике снимка — по всем алиасам. */
function isDeclaredInAnySource(ctx: QueryCtx, name: string): boolean {
  for (const fields of ctx.virtualFields.values()) {
    if (fields.some((f) => f.name === name)) return true;
  }
  for (const tableRef of ctx.sources.values()) {
    const t = ctx.fx.tables.get(tableRef)?.table;
    if (t && fieldsOf(t).some((f) => f.name === name)) return true;
  }
  return false;
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
  const f = fieldsOf(t).find((f) => f.name === fieldName);
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
