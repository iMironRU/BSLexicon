/**
 * Обёртка над сгенерированным ANTLR-парсером SDBL (#37).
 *
 * ANTLR даёт токены, дерево разбора и собственный `ANTLRErrorListener`.
 * Мы:
 *   1. Собираем ошибки в список вместо BailOut — парсинг продолжается,
 *      педагог видит все проблемы разом.
 *   2. Переводим стандартные ANTLR-сообщения («mismatched input …
 *      expecting …») в дружелюбные русскоязычные тексты с колонкой.
 *   3. Возвращаем discriminated union — UI/interpreter не работают с
 *      броском исключений.
 *
 * Сгенерированный код в `./generated/` — производный от .g4 (LGPL-3.0),
 * значит и он под LGPL. Публикуется отдельным подкаталогом; остальной
 * BSLexicon остаётся MIT.
 */

import {
  CharStream,
  CommonTokenStream,
  type ParserRuleContext,
  type RecognitionException,
  type Token,
} from 'antlr4ng';
import { SDBLLexer } from './generated/SDBLLexer';
import { SDBLParser } from './generated/SDBLParser';

export interface ParseError {
  /** 1-based номер строки. */
  line: number;
  /** 0-based позиция символа в строке (как отдаёт ANTLR). */
  column: number;
  message: string;
}

export type ParseResult =
  | { ok: true; tree: ParserRuleContext; errors: [] }
  | { ok: false; tree: ParserRuleContext | null; errors: ParseError[] };

/**
 * Разбирает исходник SDBL. При наличии синтаксических ошибок возвращает
 * `ok: false` со списком, но и `tree` может быть частично собран
 * (ANTLR-recovery) — им можно пользоваться для подсказок/подсветки.
 */
export function parseQuery(source: string): ParseResult {
  const input = CharStream.fromString(source);
  const lexer = new SDBLLexer(input);
  const errors: ParseError[] = [];
  const listener = makeCollector(errors);
  lexer.removeErrorListeners();
  lexer.addErrorListener(listener);

  const tokens = new CommonTokenStream(lexer);
  const parser = new SDBLParser(tokens);
  parser.removeErrorListeners();
  parser.addErrorListener(listener);

  const tree = parser.queryPackage();
  if (errors.length === 0) return { ok: true, tree, errors: [] };
  return { ok: false, tree, errors };
}

function makeCollector(errors: ParseError[]) {
  return {
    syntaxError<T extends Token>(
      _recognizer: unknown,
      offendingSymbol: T | null,
      line: number,
      column: number,
      msg: string,
      _e: RecognitionException | null,
    ): void {
      errors.push({
        line,
        column,
        message: humanize(msg, offendingSymbol),
      });
    },
    reportAmbiguity(): void { /* игнорируем */ },
    reportAttemptingFullContext(): void { /* игнорируем */ },
    reportContextSensitivity(): void { /* игнорируем */ },
  };
}

/**
 * Переводит стандартные ANTLR-сообщения в человекочитаемые русскоязычные.
 * ANTLR даёт вещи вроде:
 *   `mismatched input 'ГДЕ' expecting {ВЫБРАТЬ, ...}`
 *   `extraneous input ',' expecting FIELD`
 *   `no viable alternative at input 'ВЫБРАТЬ<EOF>'`
 *   `token recognition error at: '~'`
 */
function humanize(msg: string, tok: Token | null): string {
  const at = tok && tok.text ? ` рядом с «${tok.text}»` : '';
  if (msg.startsWith('mismatched input')) {
    return `Неожиданный элемент${at}. ${extractExpecting(msg)}`.trim();
  }
  if (msg.startsWith('extraneous input')) {
    return `Лишний элемент${at}. ${extractExpecting(msg)}`.trim();
  }
  if (msg.startsWith('missing')) {
    return `Пропущен элемент${at}. ${msg}`;
  }
  if (msg.startsWith('no viable alternative')) {
    return `Не удалось разобрать конструкцию${at}. Проверь, что запрос начинается с ВЫБРАТЬ и все операторы закрыты.`;
  }
  if (msg.startsWith('token recognition error')) {
    return `Непонятный символ${at}. Так писать нельзя — проверь опечатки.`;
  }
  return msg;
}

function extractExpecting(msg: string): string {
  const m = /expecting\s+(.+?)$/i.exec(msg);
  if (!m) return '';
  const raw = m[1].replace(/\{|\}/g, '').trim();
  // Ограничиваем список ожидаемого — иначе для сложного места выйдет
  // 30+ токенов, теряется педагогическая ценность.
  const items = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (items.length === 0) return '';
  if (items.length <= 3) return `Ожидалось: ${items.join(', ')}.`;
  return `Ожидалось одно из: ${items.slice(0, 3).join(', ')} и ещё ${items.length - 3}.`;
}

export { SDBLLexer, SDBLParser };
