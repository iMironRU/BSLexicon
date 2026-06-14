import type { KeywordKind } from './keywords';

export type TokenType =
  | 'number'
  | 'string'
  | 'ident'
  | 'keyword'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'dot'
  | 'semicolon'
  | 'question'
  | 'eof';

export interface Token {
  type: TokenType;
  /** Исходный текст лексемы. */
  lexeme: string;
  /** Для строк/чисел — разобранное значение; для ключевых слов — `KeywordKind`. */
  value?: string | number | KeywordKind;
  line: number;
}
