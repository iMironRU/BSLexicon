/**
 * Persistent kernel для notebook-режима (см. #23).
 *
 * `Session` — долгоживущий контейнер BSL-runtime state. Каждый вызов
 * `eval(source)` — новый Interpreter, инициализированный persistent
 * `globals` и `procedures` этой сессии; после успешного прогона state
 * остаётся мутированным для следующего вызова.
 *
 * Транзакционный откат при ошибке — lightweight: snapshot ссылок
 * `Scope.values` и `procedures` Map. Rebinding имён верхнего уровня и
 * переопределение процедур откатываются полностью. Мутации через
 * методы объектов (`Массив.Добавить(...)`) — не откатываются, значение
 * Map ссылается на тот же экземпляр. Это осознанный trade-off: полный
 * deep-clone ломает custom-объекты (Массив, ТаблицаЗначений, Дата) и
 * циклические ссылки. Если пользователю нужен чистый лист — кнопка
 * «Перезапустить kernel» вызывает `reset()`.
 *
 * `runIndex` монотонно растёт на каждый `eval`, включая упавшие: как
 * `[1]`/`[2]`/`[*]` в Jupyter — счётчик прогонов kernel'а, не порядок
 * ячеек в документе.
 */

import { Interpreter } from './interpreter/interpreter';
import { Scope } from './interpreter/scope';
import { lex } from './lexer/lexer';
import type { ProcDecl } from './parser/ast';
import { parse } from './parser/parser';
import { preprocess } from './preprocessor';
import { toRunError } from './run-error';
import type { RunError } from './run-error';

export interface SessionResult {
  ok: boolean;
  /** Вывод только этой ячейки. Прошлые ячейки в этот массив не попадают. */
  output: string[];
  error: RunError | null;
  /** Порядковый номер этого прогона в сессии (1, 2, 3, …). */
  runIndex: number;
}

export class Session {
  private globals = new Scope();
  private procedures = new Map<string, ProcDecl>();
  private runIndexCounter = 0;

  /** Прогнать очередной кусок исходника поверх накопленного состояния. */
  eval(source: string): SessionResult {
    this.runIndexCounter += 1;
    const runIndex = this.runIndexCounter;

    let preprocessed: string;
    try {
      preprocessed = preprocess(source);
    } catch (e) {
      return { ok: false, output: [], error: toRunError('lexer', e), runIndex };
    }
    try {
      const tokens = lex(preprocessed);
      const program = parse(tokens);
      // snapshot до мутаций — при ошибке восстановим
      const globalsSnap = this.globals.snapshot();
      const proceduresSnap = new Map(this.procedures);

      const interp = new Interpreter({
        initialGlobals: this.globals,
        initialProcedures: this.procedures,
      });

      try {
        // Прогоняем генератор до конца — event'ы шагов нам не нужны в
        // notebook-режиме (пошаговый debug — тема #25).
        const gen = interp.run(program);
        for (;;) {
          const step = gen.next();
          if (step.done) break;
        }
        return { ok: true, output: [...interp.output], error: null, runIndex };
      } catch (e) {
        // Откат: имена/процедуры возвращаются к состоянию до этой ячейки.
        this.globals.restore(globalsSnap);
        this.procedures.clear();
        for (const [k, v] of proceduresSnap) this.procedures.set(k, v);
        return {
          ok: false,
          output: [...interp.output],
          error: toRunError('runtime', e),
          runIndex,
        };
      }
    } catch (e) {
      // Парсер/лексер сюда — до snapshot'а. State не тронут вообще.
      const stage = errorStage(e);
      return { ok: false, output: [], error: toRunError(stage, e), runIndex };
    }
  }

  /** Полный сброс: state исчезает, счётчик прогонов — с 1. */
  reset(): void {
    this.globals = new Scope();
    this.procedures.clear();
    this.runIndexCounter = 0;
  }
}

function errorStage(e: unknown): 'lexer' | 'parser' | 'runtime' {
  // preprocess/lex/parse кидают LexError/ParseError; но здесь мы уже прошли
  // preprocess, значит это lex/parse. Различаем по имени класса, чтобы не
  // тащить cross-import.
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'LexError') return 'lexer';
  if (name === 'ParseError') return 'parser';
  return 'runtime';
}
