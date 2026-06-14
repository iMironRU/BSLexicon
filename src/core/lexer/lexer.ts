import { LexError } from '../errors';
import { KEYWORDS } from './keywords';
import type { Token, TokenType } from './token';

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isIdentStart = (ch: string): boolean => /[\p{L}_]/u.test(ch);
const isIdentPart = (ch: string): boolean => /[\p{L}\p{N}_]/u.test(ch);

/**
 * Лексер BSL (подмножество MVP). На выходе — плоский список токенов.
 *
 * Поддержано: числа, строки с экранированием `""`, идентификаторы и
 * двуязычные ключевые слова, операторы, комментарии `//`.
 * Пока не поддержано: литералы дат `'...'`, многострочные строки `|`,
 * директивы препроцессора `#...` и компиляции `&...`.
 */
export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;

  const peek = (offset = 0): string => source[pos + offset] ?? '';
  const push = (type: TokenType, lexeme: string, value?: Token['value']): void => {
    tokens.push({ type, lexeme, value, line });
  };

  while (pos < source.length) {
    const ch = source[pos];

    // Перевод строки
    if (ch === '\n') {
      line += 1;
      pos += 1;
      continue;
    }

    // Прочие пробельные символы
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pos += 1;
      continue;
    }

    // Комментарий до конца строки
    if (ch === '/' && peek(1) === '/') {
      while (pos < source.length && source[pos] !== '\n') pos += 1;
      continue;
    }

    // Число
    if (isDigit(ch)) {
      const start = pos;
      while (isDigit(peek())) pos += 1;
      if (peek() === '.' && isDigit(peek(1))) {
        pos += 1;
        while (isDigit(peek())) pos += 1;
      }
      const lexeme = source.slice(start, pos);
      push('number', lexeme, Number(lexeme));
      continue;
    }

    // Строка
    if (ch === '"') {
      const startLine = line;
      pos += 1;
      let value = '';
      while (pos < source.length) {
        const c = source[pos];
        if (c === '"') {
          if (peek(1) === '"') {
            value += '"';
            pos += 2;
            continue;
          }
          pos += 1;
          break;
        }
        if (c === '\n') {
          throw new LexError('Незакрытая строковая константа', startLine);
        }
        value += c;
        pos += 1;
        if (pos >= source.length) {
          throw new LexError('Незакрытая строковая константа', startLine);
        }
      }
      push('string', value, value);
      continue;
    }

    // Идентификатор или ключевое слово
    if (isIdentStart(ch)) {
      const start = pos;
      while (isIdentPart(peek())) pos += 1;
      const lexeme = source.slice(start, pos);
      const keyword = KEYWORDS.get(lexeme.toLowerCase());
      if (keyword) {
        push('keyword', lexeme, keyword);
      } else {
        push('ident', lexeme, lexeme);
      }
      continue;
    }

    // Операторы и пунктуация
    const two = source.slice(pos, pos + 2);
    if (two === '<>') {
      push('neq', two);
      pos += 2;
      continue;
    }
    if (two === '<=') {
      push('lte', two);
      pos += 2;
      continue;
    }
    if (two === '>=') {
      push('gte', two);
      pos += 2;
      continue;
    }

    const single: Record<string, TokenType> = {
      '+': 'plus',
      '-': 'minus',
      '*': 'star',
      '/': 'slash',
      '=': 'eq',
      '<': 'lt',
      '>': 'gt',
      '(': 'lparen',
      ')': 'rparen',
      '[': 'lbracket',
      ']': 'rbracket',
      ',': 'comma',
      '.': 'dot',
      ';': 'semicolon',
      '?': 'question',
    };
    const type = single[ch];
    if (type) {
      push(type, ch);
      pos += 1;
      continue;
    }

    throw new LexError(`Неизвестный символ «${ch}»`, line);
  }

  tokens.push({ type: 'eof', lexeme: '', line });
  return tokens;
}
