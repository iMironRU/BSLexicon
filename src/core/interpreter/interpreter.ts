import { RuntimeError } from '../errors';
import type { Binary, Expr, ProcDecl, Program, Stmt } from '../parser/ast';
import { resolveBuiltin } from './builtins';
import type { BuiltinContext } from './builtins';
import { Scope } from './scope';
import { BreakSignal, ContinueSignal, ReturnSignal } from './signals';
import {
  NULL,
  UNDEFINED,
  displayValue,
  isTruthy,
  toBslString,
  toNumber,
  typeName,
} from './values';
import type { BslValue } from './values';

/**
 * Событие шага. Интерпретатор — генератор: он `yield`-ит перед каждым
 * оператором. Драйвер (run / будущая пошаговая сессия) сам решает, когда
 * звать `.next()` — отсюда «бесплатная» пошаговая отладка (концепция §6, вариант A).
 */
export interface StepEvent {
  kind: 'statement';
  line: number;
}

/** Срез переменной для панели инспекции. */
export interface VariableView {
  name: string;
  type: string;
  display: string;
}

export class Interpreter {
  readonly output: string[] = [];
  readonly globals = new Scope();
  private readonly procedures = new Map<string, ProcDecl>();
  private readonly ctx: BuiltinContext = {
    print: (text) => this.output.push(text),
  };

  /** Главный генератор исполнения программы. */
  *run(program: Program): Generator<StepEvent, void, void> {
    // Подъём объявлений процедур/функций — видны во всём модуле.
    for (const s of program) {
      if (s.kind === 'ProcDecl') this.procedures.set(s.name.toLowerCase(), s);
    }
    try {
      yield* this.execBlock(program, this.globals);
    } catch (e) {
      if (e instanceof ReturnSignal) return; // «Возврат» на верхнем уровне = стоп
      if (e instanceof BreakSignal || e instanceof ContinueSignal) {
        throw new RuntimeError('«Прервать»/«Продолжить» вне цикла');
      }
      throw e;
    }
  }

  private *execBlock(stmts: Stmt[], scope: Scope): Generator<StepEvent, void, void> {
    for (const s of stmts) yield* this.execStatement(s, scope);
  }

  private *execStatement(s: Stmt, scope: Scope): Generator<StepEvent, void, void> {
    if (s.kind !== 'ProcDecl') yield { kind: 'statement', line: s.line };

    switch (s.kind) {
      case 'ProcDecl':
        return; // объявления уже подняты

      case 'VarDecl':
        for (const name of s.names) if (!scope.has(name)) scope.declare(name);
        return;

      case 'Assign':
        scope.set(s.target, this.evaluate(s.value, scope));
        return;

      case 'CallStmt':
        this.evaluate(s.call, scope);
        return;

      case 'If': {
        for (const branch of s.branches) {
          if (isTruthy(this.evaluate(branch.cond, scope))) {
            yield* this.execBlock(branch.body, scope);
            return;
          }
        }
        if (s.elseBody) yield* this.execBlock(s.elseBody, scope);
        return;
      }

      case 'While':
        while (isTruthy(this.evaluate(s.cond, scope))) {
          try {
            yield* this.execBlock(s.body, scope);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;

      case 'For': {
        const from = toNumber(this.evaluate(s.from, scope));
        const to = toNumber(this.evaluate(s.to, scope));
        scope.declare(s.varName, from);
        for (let i = from; i <= to; i += 1) {
          scope.set(s.varName, i);
          try {
            yield* this.execBlock(s.body, scope);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }

      case 'Return':
        throw new ReturnSignal(s.value ? this.evaluate(s.value, scope) : undefined);

      case 'Break':
        throw new BreakSignal();

      case 'Continue':
        throw new ContinueSignal();
    }
  }

  // --- Выражения (синхронны; шаг внутрь функций — следующий этап) ---

  private evaluate(e: Expr, scope: Scope): BslValue {
    switch (e.kind) {
      case 'NumberLit':
        return e.value;
      case 'StringLit':
        return e.value;
      case 'BoolLit':
        return e.value;
      case 'UndefinedLit':
        return UNDEFINED;
      case 'NullLit':
        return NULL;
      case 'Ident': {
        if (!scope.has(e.name)) {
          throw new RuntimeError(`Переменная «${e.name}» не определена`, e.line);
        }
        return scope.get(e.name) as BslValue;
      }
      case 'Unary': {
        const v = this.evaluate(e.operand, scope);
        return e.op === 'neg' ? -toNumber(v) : !isTruthy(v);
      }
      case 'Binary':
        return this.evalBinary(e, scope);
      case 'Ternary':
        return isTruthy(this.evaluate(e.cond, scope))
          ? this.evaluate(e.whenTrue, scope)
          : this.evaluate(e.whenFalse, scope);
      case 'Call':
        return this.callFunction(
          e.callee,
          e.args.map((a) => this.evaluate(a, scope)),
          e.line,
        );
    }
  }

  private evalBinary(e: Binary, scope: Scope): BslValue {
    // Короткое замыкание логических операторов
    if (e.op === 'and') {
      return isTruthy(this.evaluate(e.left, scope))
        ? isTruthy(this.evaluate(e.right, scope))
        : false;
    }
    if (e.op === 'or') {
      return isTruthy(this.evaluate(e.left, scope))
        ? true
        : isTruthy(this.evaluate(e.right, scope));
    }

    const l = this.evaluate(e.left, scope);
    const r = this.evaluate(e.right, scope);

    switch (e.op) {
      case 'add':
        if (typeof l === 'string' || typeof r === 'string') {
          return toBslString(l) + toBslString(r);
        }
        return toNumber(l) + toNumber(r);
      case 'sub':
        return toNumber(l) - toNumber(r);
      case 'mul':
        return toNumber(l) * toNumber(r);
      case 'div': {
        const d = toNumber(r);
        if (d === 0) throw new RuntimeError('Деление на ноль', e.line);
        return toNumber(l) / d;
      }
      case 'eq':
        return l === r;
      case 'neq':
        return l !== r;
      case 'lt':
        return compare(l, r, e.line) < 0;
      case 'lte':
        return compare(l, r, e.line) <= 0;
      case 'gt':
        return compare(l, r, e.line) > 0;
      case 'gte':
        return compare(l, r, e.line) >= 0;
    }
  }

  private callFunction(name: string, args: BslValue[], line: number): BslValue {
    const builtin = resolveBuiltin(name);
    if (builtin) {
      const [min, max] = builtin.arity;
      if (args.length < min || args.length > max) {
        throw new RuntimeError(
          `«${name}»: ожидалось аргументов ${min}..${max}, передано ${args.length}`,
          line,
        );
      }
      return builtin.impl(args, this.ctx);
    }

    const proc = this.procedures.get(name.toLowerCase());
    if (proc) return this.callUser(proc, args);

    throw new RuntimeError(`Неизвестная процедура или функция «${name}»`, line);
  }

  private callUser(decl: ProcDecl, args: BslValue[]): BslValue {
    const frame = new Scope();
    decl.params.forEach((p, i) => {
      const value =
        i < args.length
          ? args[i]
          : p.default
            ? this.evaluate(p.default, this.globals)
            : UNDEFINED;
      frame.declare(p.name, value);
    });

    // Скелет: тело функции исполняется до конца без шага внутрь.
    // Генератор-плумбинг уже на месте — step-into добавится позже.
    try {
      const gen = this.execBlock(decl.body, frame);
      let res = gen.next();
      while (!res.done) res = gen.next();
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value ?? UNDEFINED;
      throw e;
    }
    return UNDEFINED;
  }

  /** Срез глобальной области для панели переменных. */
  inspectGlobals(): VariableView[] {
    return this.globals.entries().map(({ name, value }) => ({
      name,
      type: typeName(value),
      display: displayValue(value),
    }));
  }
}

function compare(l: BslValue, r: BslValue, line: number): number {
  if (typeof l === 'number' && typeof r === 'number') {
    return l < r ? -1 : l > r ? 1 : 0;
  }
  if (typeof l === 'string' && typeof r === 'string') {
    return l < r ? -1 : l > r ? 1 : 0;
  }
  throw new RuntimeError('Невозможно сравнить значения разных типов', line);
}
