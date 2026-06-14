import { BslError } from './errors';
import { Interpreter } from './interpreter/interpreter';
import type { VariableView } from './interpreter/interpreter';
import { lex } from './lexer/lexer';
import type { Token } from './lexer/token';
import type { Program } from './parser/ast';
import { parse } from './parser/parser';

export { lex } from './lexer/lexer';
export { parse } from './parser/parser';
export { Interpreter } from './interpreter/interpreter';
export { builtinIds, BUILTINS } from './interpreter/builtins';
export { BslError, LexError, ParseError, RuntimeError } from './errors';
export type { StepEvent, VariableView } from './interpreter/interpreter';
export type { Token } from './lexer/token';

export type RunStage = 'lexer' | 'parser' | 'runtime';

export interface RunError {
  stage: RunStage;
  message: string;
  line?: number;
}

export type RunResult =
  | { ok: true; output: string[]; variables: VariableView[] }
  | { ok: false; output: string[]; error: RunError };

/**
 * Удобная обёртка: лексер → парсер → интерпретатор до завершения.
 * Для пошаговой отладки используйте `Interpreter#run` напрямую (это генератор).
 */
export function run(source: string): RunResult {
  let tokens: Token[];
  try {
    tokens = lex(source);
  } catch (e) {
    return { ok: false, output: [], error: toRunError('lexer', e) };
  }

  let ast: Program;
  try {
    ast = parse(tokens);
  } catch (e) {
    return { ok: false, output: [], error: toRunError('parser', e) };
  }

  const interp = new Interpreter();
  try {
    const gen = interp.run(ast);
    let res = gen.next();
    while (!res.done) res = gen.next();
  } catch (e) {
    return { ok: false, output: interp.output, error: toRunError('runtime', e) };
  }

  return { ok: true, output: interp.output, variables: interp.inspectGlobals() };
}

function toRunError(stage: RunStage, e: unknown): RunError {
  if (e instanceof BslError) {
    return { stage, message: e.message, line: e.line };
  }
  return { stage, message: e instanceof Error ? e.message : String(e) };
}
