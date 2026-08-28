import { Interpreter } from './interpreter/interpreter';
import type { VariableView } from './interpreter/interpreter';
import { lex } from './lexer/lexer';
import type { Token } from './lexer/token';
import type { Program } from './parser/ast';
import { parse } from './parser/parser';
import { preprocess } from './preprocessor';
import { toRunError } from './run-error';
import type { RunError } from './run-error';

export { lex } from './lexer/lexer';
export { parse } from './parser/parser';
export { Interpreter } from './interpreter/interpreter';
export { builtinIds, BUILTINS } from './interpreter/builtins';
export { methodIds, propertyIds } from './interpreter/collections';
export { KEYWORDS } from './lexer/keywords';
export type { KeywordKind } from './lexer/keywords';
export { BslError, LexError, ParseError, RuntimeError } from './errors';
export { DebugSession } from './debugger/session';
export { toRunError } from './run-error';
export { parseCatalog, buildCatalog, loadCatalogFrom, methodTypeOf } from './catalog';
export type {
  Catalog,
  CatalogEntry,
  CatalogKind,
  CatalogNames,
  CatalogParam,
  CatalogReturns,
  CatalogExample,
} from './catalog';
export type { StepEvent, VariableView, FrameView } from './interpreter/interpreter';
export type { Token } from './lexer/token';
export type { RunStage, RunError } from './run-error';
export type { DebugState, DebugSnapshot, DebugFrame } from './debugger/session';

export type RunResult =
  | { ok: true; output: string[]; variables: VariableView[] }
  | { ok: false; output: string[]; error: RunError };

/**
 * Удобная обёртка: лексер → парсер → интерпретатор до завершения.
 * Для пошаговой отладки используйте `Interpreter#run` напрямую (это генератор).
 *
 * REPL-fallback (см. #21): книги часто показывают семантику одиночным
 * выражением без `;` (`10 / 3`, `"а" = "а"`). Если parse упал на такой
 * форме — пробуем `Сообщить(<source>);` — так читатель видит значение.
 * Fallback безопасен: если новая версия тоже не парсится, возвращаем
 * ОРИГИНАЛЬНУЮ ошибку (её легче интерпретировать пользователю).
 */
export function run(source: string): RunResult {
  const first = runOnce(source);
  if (first.ok) return first;
  if (first.error.stage !== 'parser') return first;
  if (source.trim().endsWith(';')) return first;
  const wrapped = runOnce(`Сообщить(${source.trim()});`);
  return wrapped.ok ? wrapped : first;
}

function runOnce(source: string): RunResult {
  let preprocessed: string;
  try {
    preprocessed = preprocess(source);
  } catch (e) {
    // Ошибки препроцессора репортим как ошибки лексера — это единая фаза
    // «до parsing», отдельный stage читателю не важен.
    return { ok: false, output: [], error: toRunError('lexer', e) };
  }

  let tokens: Token[];
  try {
    tokens = lex(preprocessed);
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
