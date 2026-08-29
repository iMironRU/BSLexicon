/**
 * Обход AST в поисках прямых вызовов и `Новый <Тип>`. Возвращает
 * warnings по каждому найденному имени, которое не проходит Target.
 *
 * Проходит через всё дерево: statements + expressions. Ошибки лексера
 * или парсера — swallow'им (просто не даём warnings; ошибки редактор
 * покажет сам через существующий run-error).
 */

import { lex, parse } from '@core/index';
import type {
  Expr,
  IfBranch,
  Program,
  Stmt,
} from '@core/parser/ast';
import type { Target } from '../../help/target';
import { checkName, reasonToMessage, type AvailabilityIndex, type WarningReason } from './index';

export interface Warning {
  line: number;
  /** Стартовая колонка (1-based, для monaco). Опционально — если не знаем, всё поле. */
  column?: number;
  /** Длина в символах для подсветки. */
  length?: number;
  reason: WarningReason;
  message: string;
}

export function scanForWarnings(
  source: string,
  target: Target,
  index: AvailabilityIndex,
): Warning[] {
  let program: Program;
  try {
    const tokens = lex(source);
    program = parse(tokens);
  } catch {
    return []; // невалидный код — не даём warnings, редактор сам покажет ошибку
  }

  const warnings: Warning[] = [];
  for (const s of program) visitStmt(s, target, index, warnings, source);
  return warnings;
}

function visitStmt(s: Stmt, target: Target, index: AvailabilityIndex, out: Warning[], source: string): void {
  switch (s.kind) {
    case 'ProcDecl':
      for (const p of s.params) if (p.default) visitExpr(p.default, target, index, out, source);
      for (const inner of s.body) visitStmt(inner, target, index, out, source);
      return;
    case 'VarDecl':
    case 'Break':
    case 'Continue':
    case 'Label':
    case 'Goto':
      return;
    case 'Assign':
      visitExpr(s.value, target, index, out, source);
      return;
    case 'ExprStmt':
      visitExpr(s.expr, target, index, out, source);
      return;
    case 'If':
      for (const b of s.branches as IfBranch[]) {
        visitExpr(b.cond, target, index, out, source);
        for (const inner of b.body) visitStmt(inner, target, index, out, source);
      }
      if (s.elseBody) for (const inner of s.elseBody) visitStmt(inner, target, index, out, source);
      return;
    case 'While':
      visitExpr(s.cond, target, index, out, source);
      for (const inner of s.body) visitStmt(inner, target, index, out, source);
      return;
    case 'For':
      visitExpr(s.from, target, index, out, source);
      visitExpr(s.to, target, index, out, source);
      for (const inner of s.body) visitStmt(inner, target, index, out, source);
      return;
    case 'ForEach':
      visitExpr(s.iterable, target, index, out, source);
      for (const inner of s.body) visitStmt(inner, target, index, out, source);
      return;
    case 'Return':
      if (s.value) visitExpr(s.value, target, index, out, source);
      return;
    case 'Try':
      for (const inner of s.body) visitStmt(inner, target, index, out, source);
      for (const inner of s.handler) visitStmt(inner, target, index, out, source);
      return;
    case 'Raise':
      if (s.message) visitExpr(s.message, target, index, out, source);
      return;
  }
}

function visitExpr(e: Expr, target: Target, index: AvailabilityIndex, out: Warning[], source: string): void {
  switch (e.kind) {
    case 'NumberLit':
    case 'StringLit':
    case 'BoolLit':
    case 'UndefinedLit':
    case 'NullLit':
    case 'DateLit':
    case 'Ident':
      return;
    case 'Unary':
      visitExpr(e.operand, target, index, out, source);
      return;
    case 'Binary':
      visitExpr(e.left, target, index, out, source);
      visitExpr(e.right, target, index, out, source);
      return;
    case 'Ternary':
      visitExpr(e.cond, target, index, out, source);
      visitExpr(e.whenTrue, target, index, out, source);
      visitExpr(e.whenFalse, target, index, out, source);
      return;
    case 'Call': {
      const r = checkName('function', e.callee, target, index);
      if (r) out.push(warningAt(source, e.line, e.callee, r));
      for (const a of e.args) visitExpr(a, target, index, out, source);
      return;
    }
    case 'New': {
      const r = checkName('type', e.typeName, target, index);
      if (r) out.push(warningAt(source, e.line, e.typeName, r));
      for (const a of e.args) visitExpr(a, target, index, out, source);
      return;
    }
    case 'Member':
      visitExpr(e.object, target, index, out, source);
      return;
    case 'Index':
      visitExpr(e.object, target, index, out, source);
      visitExpr(e.index, target, index, out, source);
      return;
    case 'MethodCall':
      visitExpr(e.object, target, index, out, source);
      for (const a of e.args) visitExpr(a, target, index, out, source);
      return;
  }
}

/**
 * Пытается найти начальную колонку `name` на строке `line` — для точной
 * подсветки. Если не нашёл, отдаёт warning без column (Monaco подсветит
 * всю строку).
 */
function warningAt(source: string, line: number, name: string, reason: WarningReason): Warning {
  const lines = source.split('\n');
  const src = lines[line - 1] ?? '';
  const idx = src.toLowerCase().indexOf(name.toLowerCase());
  const base = { line, reason, message: reasonToMessage(reason) };
  if (idx < 0) return base;
  return { ...base, column: idx + 1, length: name.length };
}
