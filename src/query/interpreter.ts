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
import { rowsOf } from './fixture';
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
  QueryContext,
  QueryPackageContext,
  SelectQueryContext,
  SubqueryContext,
  TableContext,
} from './parser/generated/SDBLParser';

// ── Публичный API ──────────────────────────────────────────────────

export interface Rowset {
  columns: string[];
  rows: BslValue[][];
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

export function runQuery(source: string, fx: Fixture): RunResult {
  const parsed = parseQuery(source);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors.map((e) => ({ stage: 'parser', message: e.message, line: e.line, column: e.column })) };
  }
  try {
    const { rowset, warnings } = execPackage(parsed.tree as QueryPackageContext, fx);
    return { ok: true, rowset, warnings };
  } catch (e) {
    if (e instanceof QueryRuntimeError) return { ok: false, errors: [{ stage: 'runtime', message: e.message }] };
    return { ok: false, errors: [{ stage: 'runtime', message: (e as Error).message ?? String(e) }] };
  }
}

// ── Дерево ──────────────────────────────────────────────────────────

interface ExecResult { rowset: Rowset; warnings: string[]; }

function execPackage(pkg: QueryPackageContext, fx: Fixture): ExecResult {
  const queries = pkg.queries();
  if (queries.length === 0) throw new QueryRuntimeError('Пустой пакет запросов');
  if (queries.length > 1) throw new QueryRuntimeError('Пакеты запросов пока не поддерживаются (см. #46)');
  const q = queries[0];
  if (q.dropTableQuery()) throw new QueryRuntimeError('УНИЧТОЖИТЬ пока не поддерживается (см. #46)');
  const sel = q.selectQuery();
  if (!sel) throw new QueryRuntimeError('Ожидался ВЫБРАТЬ-запрос');
  return execSelectQuery(sel, fx);
}

function execSelectQuery(node: SelectQueryContext, fx: Fixture): ExecResult {
  const sub = node.subquery() as SubqueryContext | null;
  if (!sub) throw new QueryRuntimeError('Пустой SELECT');
  if (sub._unions && sub._unions.length > 0) throw new QueryRuntimeError('ОБЪЕДИНИТЬ пока не поддерживается (следующий шаг)');
  const main = sub._main;
  if (!main) throw new QueryRuntimeError('Отсутствует основная часть SELECT');
  if (main.temporaryTableIdentifier?.()) throw new QueryRuntimeError('ПОМЕСТИТЬ пока не поддерживается (#46)');

  const { rowset, warnings } = execQuery(main, fx);

  // ORDER BY может быть либо в subquery (стандартное место), либо на
  // уровне selectQuery (после ИТОГИ / АВТОУПОРЯДОЧИВАНИЕ).
  const orderBy = node._orders ?? sub.orderBy?.();
  if (orderBy) applyOrderBy(rowset, orderBy);
  if (node._totals) throw new QueryRuntimeError('ИТОГИ ПО пока не реализованы (#45)');

  return { rowset, warnings };
}

interface QueryCtx {
  fx: Fixture;
  /** алиас источника → полное имя таблицы. */
  sources: Map<string, string>;
  /** Собранные warning'и: неизвестные поля, битые ссылки. */
  warnings: Set<string>;
}

/** Одна «строка-снимок»: алиас → Row исходной таблицы. */
type Snap = Map<string, Row>;

function execQuery(q: QueryContext, fx: Fixture): ExecResult {
  const ctx: QueryCtx = { fx, sources: new Map(), warnings: new Set() };

  // FROM
  const snaps: Snap[] = q._from_ ? collectDataSources(q._from_.dataSource(), ctx) : [new Map()];

  // WHERE
  const filtered = q._where ? snaps.filter((s) => isTruthy(evalNode(q._where!, s, ctx, null))) : snaps;

  // SELECT
  const columnSpecs = collectSelectedFields(q);

  // GROUP BY / HAVING / агрегаты
  const groupExprs = q._groupBy ?? [];
  const hasAgg = columnSpecs.some((c) => containsAggregate(c.expr));

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
      rows.push(columnSpecs.map((c) => evalNode(c.expr, bucket[0] ?? new Map(), ctx, bucket)));
    }
    return { rowset: { columns: columnSpecs.map((c) => c.name), rows }, warnings: [...ctx.warnings] };
  }

  const rows: BslValue[][] = filtered.map((s) => columnSpecs.map((c) => evalNode(c.expr, s, ctx, null)));
  return { rowset: { columns: columnSpecs.map((c) => c.name), rows }, warnings: [...ctx.warnings] };
}

// ── Источники ─────────────────────────────────────────────────────

function collectDataSources(dataSources: DataSourceContext[], ctx: QueryCtx): Snap[] {
  let out: Snap[] | null = null;
  for (const ds of dataSources) {
    // Проверяем виртуальные таблицы регистров прежде обычных
    if (ds.virtualTable?.()) {
      throw new QueryRuntimeError('Виртуальные таблицы регистров пока не реализованы (#44/#47)');
    }
    if (ds.parameterTable?.()) throw new QueryRuntimeError('Параметрические таблицы пока не поддерживаются');
    if (ds.externalDataSourceTable?.()) throw new QueryRuntimeError('Внешние источники данных пока не поддерживаются');
    if (ds.subquery?.()) throw new QueryRuntimeError('Подзапросы в FROM пока не поддерживаются');
    const primary = ds.table();
    if (!primary) throw new QueryRuntimeError('Некорректный источник ИЗ');
    let snaps = readTable(primary, ctx);
    for (const j of ds._joins ?? []) snaps = applyJoin(snaps, j, ctx);
    out = out === null ? snaps : cross(out, snaps);
  }
  return out ?? [];
}

function readTable(table: TableContext, ctx: QueryCtx): Snap[] {
  const mdo = table.mdo();
  if (!mdo) throw new QueryRuntimeError('Источник не является объектом метаданных');

  const ref = mdoRef(mdo);
  const rows = rowsOf(ctx.fx, ref);
  if (rows === null) throw new QueryRuntimeError(`Таблица «${ref}» не найдена в схеме`);
  const alias = readAlias(table) ?? ref;
  ctx.sources.set(alias, ref);
  return rows.map((r) => new Map([[alias, r]]) as Snap);
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

interface ColumnSpec { name: string; expr: ExpressionContext | LogicalExpressionContext; }

function collectSelectedFields(q: QueryContext): ColumnSpec[] {
  const container = q._columns;
  if (!container) throw new QueryRuntimeError('Отсутствует список полей ВЫБРАТЬ');
  const fields = container.selectedField();
  const out: ColumnSpec[] = [];
  for (const f of fields) {
    if (f.asteriskField()) throw new QueryRuntimeError('ВЫБРАТЬ * пока не поддерживается — укажи явные поля');
    const exprField = f.expressionField();
    if (!exprField) throw new QueryRuntimeError('Не удалось разобрать поле ВЫБРАТЬ');
    const expr = exprField.expression() ?? exprField.logicalExpression();
    if (!expr) throw new QueryRuntimeError('Не удалось разобрать выражение поля');
    const alias = readAlias(f) ?? defaultAliasFromExpr(expr);
    out.push({ name: alias, expr });
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
  if (node instanceof ParameterContext) return NULL; // параметры &Имя — пусты (для MVP)

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
  const [alias, ...path] = names;
  let cur: Row | null = snap.get(alias) as Row | null;
  if (!cur) {
    ctx.warnings.add(`Алиас источника «${alias}» не найден`);
    return UNDEFINED;
  }
  let tableRef = ctx.sources.get(alias);
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
      const targetTable = findRefsField(ctx.fx, tableRef, path[i]);
      if (!targetTable) return UNDEFINED;
      const nextRow: Row | null = ctx.fx.tables.get(targetTable)?.byRef.get(val) ?? null;
      cur = nextRow;
      tableRef = targetTable;
    } else {
      return UNDEFINED;
    }
  }
  return UNDEFINED;
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
