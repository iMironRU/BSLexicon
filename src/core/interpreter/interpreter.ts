import { RuntimeError } from '../errors';
import type { Binary, Expr, LValue, ProcDecl, Program, Stmt } from '../parser/ast';
import { resolveBuiltin } from './builtins';
import type { BuiltinContext } from './builtins';
import {
  getIndex,
  getMember,
  iterate,
  resolveConstructor,
  resolveMethod,
  setIndex,
  setMember,
} from './collections';
import { Scope } from './scope';
import { BreakSignal, ContinueSignal, ReturnSignal } from './signals';
import {
  BslObject,
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
 * оператором. Драйвер (run / пошаговая сессия) сам решает, когда звать
 * `.next()` — отсюда «бесплатная» пошаговая отладка (концепция §6, вариант A).
 *
 * `depth` — глубина стека кадров на момент yield (1 = модуль, 2 = внутри
 * функции, и т.д.); на нём драйвер строит step over/out.
 */
export interface StepEvent {
  kind: 'statement';
  line: number;
  depth: number;
}

/** Срез переменной для панели инспекции. */
export interface VariableView {
  name: string;
  type: string;
  display: string;
}

/** Кадр стека вызовов: имя, своя область видимости, текущая строка. */
interface Frame {
  name: string;
  scope: Scope;
  line: number;
}

/** Срез кадра для панели «Стек вызовов». */
export interface FrameView {
  name: string;
  line: number;
}

const MODULE_FRAME = '<Модуль>';

/**
 * Предел исполненных шагов по умолчанию. Исполнение синхронное в главном потоке
 * (концепция §6, вариант A), поэтому бесконечный цикл иначе вешает вкладку.
 * Порог заведомо выше любого учебного примера — ловит именно зацикливание.
 */
const DEFAULT_STEP_LIMIT = 1_000_000;

export class Interpreter {
  readonly output: string[] = [];
  readonly globals = new Scope();
  private readonly frames: Frame[] = [];
  private readonly procedures = new Map<string, ProcDecl>();
  private readonly ctx: BuiltinContext = {
    print: (text) => this.output.push(text),
  };
  private steps = 0;
  private readonly stepLimit: number;

  /** @param options.stepLimit — бюджет шагов-операторов и итераций циклов. */
  constructor(options: { stepLimit?: number } = {}) {
    this.stepLimit = options.stepLimit ?? DEFAULT_STEP_LIMIT;
  }

  /**
   * Такт «бюджета шагов»: один на каждый исполненный оператор и на каждую
   * итерацию цикла. Превышение — почти наверняка бесконечный цикл: роняем
   * рантайм-ошибкой, а не подвешиваем главный поток.
   */
  private tick(line: number): void {
    this.steps += 1;
    if (this.steps > this.stepLimit) {
      throw new RuntimeError(
        `Превышен лимит шагов (${this.stepLimit}) — похоже на бесконечный цикл`,
        line,
      );
    }
  }

  /** Главный генератор исполнения программы. */
  *run(program: Program): Generator<StepEvent, void, void> {
    // Подъём объявлений процедур/функций — видны во всём модуле.
    for (const s of program) {
      if (s.kind === 'ProcDecl') this.procedures.set(s.name.toLowerCase(), s);
    }
    this.frames.push({ name: MODULE_FRAME, scope: this.globals, line: 0 });
    try {
      yield* this.execBlock(program, this.globals);
    } catch (e) {
      if (e instanceof ReturnSignal) return; // «Возврат» на верхнем уровне = стоп
      if (e instanceof BreakSignal || e instanceof ContinueSignal) {
        throw new RuntimeError('«Прервать»/«Продолжить» вне цикла');
      }
      throw e;
    } finally {
      this.frames.pop();
    }
  }

  private *execBlock(stmts: Stmt[], scope: Scope): Generator<StepEvent, void, void> {
    for (const s of stmts) yield* this.execStatement(s, scope);
  }

  private *execStatement(s: Stmt, scope: Scope): Generator<StepEvent, void, void> {
    if (s.kind !== 'ProcDecl') {
      this.tick(s.line);
      this.frames[this.frames.length - 1].line = s.line;
      yield { kind: 'statement', line: s.line, depth: this.frames.length };
    }

    switch (s.kind) {
      case 'ProcDecl':
        return; // объявления уже подняты

      case 'VarDecl':
        for (const name of s.names) if (!scope.has(name)) scope.declare(name);
        return;

      case 'Assign': {
        const value = yield* this.evaluate(s.value, scope);
        yield* this.assignTo(s.target, value, scope);
        return;
      }

      case 'ExprStmt':
        yield* this.evaluate(s.expr, scope);
        return;

      case 'If': {
        for (const branch of s.branches) {
          if (isTruthy(yield* this.evaluate(branch.cond, scope))) {
            yield* this.execBlock(branch.body, scope);
            return;
          }
        }
        if (s.elseBody) yield* this.execBlock(s.elseBody, scope);
        return;
      }

      case 'While':
        while (isTruthy(yield* this.evaluate(s.cond, scope))) {
          this.tick(s.line);
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
        const from = toNumber(yield* this.evaluate(s.from, scope));
        const to = toNumber(yield* this.evaluate(s.to, scope));
        scope.declare(s.varName, from);
        for (let i = from; i <= to; i += 1) {
          this.tick(s.line);
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

      case 'ForEach': {
        const iterable = yield* this.evaluate(s.iterable, scope);
        scope.declare(s.varName, UNDEFINED);
        for (const item of iterate(iterable, s.line)) {
          this.tick(s.line);
          scope.set(s.varName, item);
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

      case 'Return': {
        const value = s.value ? yield* this.evaluate(s.value, scope) : undefined;
        throw new ReturnSignal(value);
      }

      case 'Break':
        throw new BreakSignal();

      case 'Continue':
        throw new ContinueSignal();
    }
  }

  // --- Выражения: генераторы, чтобы вызовы внутри них раскрывались пошагово ---

  private *evaluate(e: Expr, scope: Scope): Generator<StepEvent, BslValue, void> {
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
        const v = yield* this.evaluate(e.operand, scope);
        return e.op === 'neg' ? -toNumber(v) : !isTruthy(v);
      }
      case 'Binary':
        return yield* this.evalBinary(e, scope);
      case 'Ternary':
        return isTruthy(yield* this.evaluate(e.cond, scope))
          ? yield* this.evaluate(e.whenTrue, scope)
          : yield* this.evaluate(e.whenFalse, scope);
      case 'Call': {
        const args: BslValue[] = [];
        for (const a of e.args) args.push(yield* this.evaluate(a, scope));
        return yield* this.callFunction(e.callee, args, e.line);
      }
      case 'New': {
        const ctor = resolveConstructor(e.typeName);
        if (!ctor) throw new RuntimeError(`«Новый»: неизвестный тип «${e.typeName}»`, e.line);
        const args: BslValue[] = [];
        for (const a of e.args) args.push(yield* this.evaluate(a, scope));
        return ctor.build(args);
      }
      case 'Member': {
        const obj = yield* this.evaluate(e.object, scope);
        return getMember(obj, e.name, e.line);
      }
      case 'Index': {
        const obj = yield* this.evaluate(e.object, scope);
        const key = yield* this.evaluate(e.index, scope);
        return getIndex(obj, key, e.line);
      }
      case 'MethodCall': {
        const obj = yield* this.evaluate(e.object, scope);
        const args: BslValue[] = [];
        for (const a of e.args) args.push(yield* this.evaluate(a, scope));
        return this.callMethod(obj, e.method, args, e.line);
      }
    }
  }

  /** Присваивание по l-value: переменная, свойство (`Стр.Ключ`) или элемент (`Масс[i]`). */
  private *assignTo(
    target: LValue,
    value: BslValue,
    scope: Scope,
  ): Generator<StepEvent, void, void> {
    switch (target.kind) {
      case 'Ident':
        scope.set(target.name, value);
        return;
      case 'Member': {
        const obj = yield* this.evaluate(target.object, scope);
        setMember(obj, target.name, value, target.line);
        return;
      }
      case 'Index': {
        const obj = yield* this.evaluate(target.object, scope);
        const key = yield* this.evaluate(target.index, scope);
        setIndex(obj, key, value, target.line);
        return;
      }
    }
  }

  private callMethod(obj: BslValue, method: string, args: BslValue[], line: number): BslValue {
    if (!(obj instanceof BslObject)) {
      throw new RuntimeError(`У значения типа «${typeName(obj)}» нет методов`, line);
    }
    const def = resolveMethod(obj.typeName, method);
    if (!def) {
      throw new RuntimeError(`У типа «${obj.typeName}» нет метода «${method}»`, line);
    }
    const [min, max] = def.arity;
    if (args.length < min || args.length > max) {
      throw new RuntimeError(
        `«${method}»: ожидалось аргументов ${min}..${max}, передано ${args.length}`,
        line,
      );
    }
    return def.impl(obj, args, line);
  }

  private *evalBinary(e: Binary, scope: Scope): Generator<StepEvent, BslValue, void> {
    // Короткое замыкание логических операторов
    if (e.op === 'and') {
      return isTruthy(yield* this.evaluate(e.left, scope))
        ? isTruthy(yield* this.evaluate(e.right, scope))
        : false;
    }
    if (e.op === 'or') {
      return isTruthy(yield* this.evaluate(e.left, scope))
        ? true
        : isTruthy(yield* this.evaluate(e.right, scope));
    }

    const l = yield* this.evaluate(e.left, scope);
    const r = yield* this.evaluate(e.right, scope);

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

  private *callFunction(
    name: string,
    args: BslValue[],
    line: number,
  ): Generator<StepEvent, BslValue, void> {
    const builtin = resolveBuiltin(name);
    if (builtin) {
      const [min, max] = builtin.arity;
      if (args.length < min || args.length > max) {
        throw new RuntimeError(
          `«${name}»: ожидалось аргументов ${min}..${max}, передано ${args.length}`,
          line,
        );
      }
      return builtin.impl(args, this.ctx); // во встроенные функции не шагаем
    }

    const proc = this.procedures.get(name.toLowerCase());
    if (proc) return yield* this.callUser(proc, args);

    throw new RuntimeError(`Неизвестная процедура или функция «${name}»`, line);
  }

  private *callUser(decl: ProcDecl, args: BslValue[]): Generator<StepEvent, BslValue, void> {
    const frame = new Scope();
    for (let i = 0; i < decl.params.length; i += 1) {
      const p = decl.params[i];
      let value: BslValue;
      if (i < args.length) value = args[i];
      else if (p.default) value = yield* this.evaluate(p.default, this.globals);
      else value = UNDEFINED;
      frame.declare(p.name, value);
    }

    // Кадр на стеке во время исполнения тела — отсюда шаг внутрь и стек вызовов.
    this.frames.push({ name: decl.name, scope: frame, line: decl.line });
    try {
      yield* this.execBlock(decl.body, frame);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value ?? UNDEFINED;
      throw e;
    } finally {
      this.frames.pop();
    }
    return UNDEFINED;
  }

  // --- Инспекция ---

  private viewScope(scope: Scope): VariableView[] {
    return scope.entries().map(({ name, value }) => ({
      name,
      type: typeName(value),
      display: displayValue(value),
    }));
  }

  /** Срез глобальной области (батч-режим и завершённая программа). */
  inspectGlobals(): VariableView[] {
    return this.viewScope(this.globals);
  }

  /** Срез переменных кадра по индексу (0 — модуль). Пусто, если кадра нет. */
  inspectFrame(index: number): VariableView[] {
    const frame = this.frames[index];
    return frame ? this.viewScope(frame.scope) : [];
  }

  /** Снимок стека вызовов: индекс 0 — модуль, последний — текущий кадр. */
  callStack(): FrameView[] {
    return this.frames.map((f) => ({ name: f.name, line: f.line }));
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
