import { Interpreter } from '../interpreter/interpreter';
import type { StepEvent, VariableView } from '../interpreter/interpreter';
import { lex } from '../lexer/lexer';
import { parse } from '../parser/parser';
import { toRunError } from '../run-error';
import type { RunError } from '../run-error';

/**
 * Состояние пошаговой сессии:
 * - `ready`    — программа разобрана, ещё не начали;
 * - `paused`   — стоим перед очередным оператором (он ещё НЕ исполнен);
 * - `finished` — программа доработала до конца;
 * - `error`    — ошибка лексера/парсера/рантайма, дальше не идём.
 */
export type DebugState = 'ready' | 'paused' | 'finished' | 'error';

/** Кадр стека вызовов со срезом своих переменных. */
export interface DebugFrame {
  name: string;
  line: number;
  variables: VariableView[];
}

/** Снимок сессии для UI. Иммутабелен: панели рендерят его напрямую. */
export interface DebugSnapshot {
  state: DebugState;
  /** Текущая (ещё не исполненная) строка, когда `paused`; иначе `null`. */
  line: number | null;
  output: string[];
  /** Переменные текущего (верхнего) кадра — для панели по умолчанию. */
  variables: VariableView[];
  /** Стек вызовов: индекс 0 — текущий кадр, дальше — вызывающие. */
  callStack: DebugFrame[];
  error: RunError | null;
}

/**
 * Драйвер пошаговой отладки поверх генераторного интерпретатора
 * (концепт §6, вариант A). Сам решает, когда звать `gen.next()`:
 * пауза = просто не двигаем генератор. Главный поток не блокируется.
 *
 * Шаг over/out строится на `depth` события: интерпретатор yield-ит глубину
 * стека кадров, и драйвер пропускает более глубокие кадры (over) или ждёт
 * выхода в вызывающего (out).
 */
export class DebugSession {
  readonly breakpoints = new Set<number>();

  private readonly interp = new Interpreter();
  private gen: Generator<StepEvent, void, void> | null = null;
  private _state: DebugState = 'ready';
  private _line: number | null = null;
  private _depth = 0;
  private _error: RunError | null = null;

  constructor(source: string) {
    let tokens;
    try {
      tokens = lex(source);
    } catch (e) {
      this.fail('lexer', e);
      return;
    }
    try {
      const ast = parse(tokens);
      this.gen = this.interp.run(ast);
    } catch (e) {
      this.fail('parser', e);
    }
  }

  get state(): DebugState {
    return this._state;
  }

  toggleBreakpoint(line: number): void {
    if (this.breakpoints.has(line)) this.breakpoints.delete(line);
    else this.breakpoints.add(line);
  }

  /** Шаг с заходом внутрь вызываемых функций (step into): один такт. */
  stepInto(): DebugSnapshot {
    this.advance();
    return this.snapshot();
  }

  /** Шаг через вызов (step over): вызовы исполняются целиком, не заходя внутрь. */
  stepOver(): DebugSnapshot {
    if (this._state === 'ready') return this.stepInto(); // ещё не на операторе — нечего проходить
    const start = this._depth;
    this.advance();
    while (this._state === 'paused' && this._depth > start) this.advance();
    return this.snapshot();
  }

  /** Шаг наружу (step out): доисполнить текущий кадр и встать в вызывающем. */
  stepOut(): DebugSnapshot {
    if (this._state === 'ready') return this.stepInto(); // ещё не на операторе — нечего выходить
    const start = this._depth;
    this.advance();
    while (this._state === 'paused' && this._depth >= start) this.advance();
    return this.snapshot();
  }

  /** Продолжить до следующей точки останова либо до конца. */
  continueRun(): DebugSnapshot {
    this.advance(); // сойти с текущей строки
    while (this._state === 'paused' && !this.breakpoints.has(this._line as number)) {
      this.advance();
    }
    return this.snapshot();
  }

  /** Доисполнить программу до конца без остановок (батч-режим). */
  runToEnd(): DebugSnapshot {
    while (this._state === 'ready' || this._state === 'paused') this.advance();
    return this.snapshot();
  }

  /** Текущий снимок без продвижения. */
  snapshot(): DebugSnapshot {
    // callStack интерпретатора: [модуль, …, текущий]; для UI разворачиваем —
    // текущий кадр сверху.
    const callStack: DebugFrame[] = this.interp
      .callStack()
      .map((f, i) => ({ name: f.name, line: f.line, variables: this.interp.inspectFrame(i) }))
      .reverse();

    return {
      state: this._state,
      line: this._line,
      output: [...this.interp.output],
      variables: callStack.length ? callStack[0].variables : this.interp.inspectGlobals(),
      callStack,
      error: this._error,
    };
  }

  /** Один такт генератора с обработкой завершения и рантайм-ошибок. */
  private advance(): void {
    if (this._state !== 'ready' && this._state !== 'paused') return;
    if (!this.gen) return;
    try {
      const res = this.gen.next();
      if (res.done) {
        this._state = 'finished';
        this._line = null;
        this._depth = 0;
      } else {
        this._state = 'paused';
        this._line = res.value.line;
        this._depth = res.value.depth;
      }
    } catch (e) {
      this._state = 'error';
      this._line = null;
      this._depth = 0;
      this._error = toRunError('runtime', e);
    }
  }

  private fail(stage: 'lexer' | 'parser', e: unknown): void {
    this._state = 'error';
    this._error = toRunError(stage, e);
  }
}
