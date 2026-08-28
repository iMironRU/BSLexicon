/**
 * Препроцессор BSL: `#Если`/`#ИначеЕсли`/`#Иначе`/`#КонецЕсли`.
 *
 * Работает ДО лексера — построчно вычисляет условия и оставляет только
 * активные ветки, «выключенные» заменяет на пустые строки (сохраняем
 * нумерацию — ошибки лексера/парсера должны указывать на исходные строки).
 *
 * Директивы препроцессора сами тоже заменяются на пустые строки — они
 * не попадают в лексер.
 *
 * Контекст компиляции: тренажёр не знает «клиент» или «сервер»,
 * поэтому все известные символы равны Истине. Условие вычисляется
 * привычным `И`/`ИЛИ`/`НЕ`. Так `#Если Клиент И Сервер` = Истина
 * (берётся), а `#Если НЕ Сервер` = Ложь (не берётся).
 *
 * Ошибка в условии = LexError с осмысленным сообщением.
 */

import { LexError } from './errors';

/** Символы контекста компиляции 1С — все считаем Истиной в тренажёре. */
const CONTEXT_SYMBOLS = new Set([
  'клиент',
  'тонкийклиент',
  'толстыйклиент',
  'сервер',
  'внешнеесоединение',
  'мобильноеприложениеклиент',
  'мобильноеприложениесервер',
  'мобильныйавтономныйсервер',
  'вебклиент',
]);

interface IfFrame {
  /** Активна ли текущая ветка (её содержимое включается в выход). */
  taken: boolean;
  /** Уже сработала одна из ветвей этого `#Если` — все последующие пропускаем. */
  done: boolean;
}

export function preprocess(source: string): string {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  const stack: IfFrame[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const lineNo = i + 1;

    if (trimmed.startsWith('#')) {
      const rest = trimmed.slice(1).trimStart();
      const lower = rest.toLowerCase();

      if (lower.startsWith('если ') || lower.startsWith('if ')) {
        const cond = parseCondition(stripKeyword(rest, ['если', 'if']), lineNo);
        const taken = enclosingActive(stack) && cond;
        stack.push({ taken, done: taken });
        out.push('');
        continue;
      }
      if (lower.startsWith('иначеесли ') || lower.startsWith('elsif ')) {
        assertOpen(stack, '#ИначеЕсли', lineNo);
        const frame = stack[stack.length - 1];
        if (!frame.done && enclosingActive(stack, 1)) {
          const cond = parseCondition(stripKeyword(rest, ['иначеесли', 'elsif']), lineNo);
          frame.taken = cond;
          frame.done = frame.done || cond;
        } else {
          frame.taken = false;
        }
        out.push('');
        continue;
      }
      if (lower === 'иначе' || lower === 'else') {
        assertOpen(stack, '#Иначе', lineNo);
        const frame = stack[stack.length - 1];
        frame.taken = !frame.done && enclosingActive(stack, 1);
        frame.done = true;
        out.push('');
        continue;
      }
      if (lower === 'конецесли' || lower === 'endif') {
        assertOpen(stack, '#КонецЕсли', lineNo);
        stack.pop();
        out.push('');
        continue;
      }
      // Другие директивы препроцессора (#Область/#КонецОбласти) — просто
      // выкидываем, читаемости лексера они не мешают, у нас нет folding.
      if (lower.startsWith('область') || lower.startsWith('конецобласти') ||
          lower.startsWith('region') || lower.startsWith('endregion')) {
        out.push('');
        continue;
      }
      // Неизвестная директива — оставляем в исходной строке, лексер
      // потом упадёт с внятной ошибкой на «неизвестном символе #».
    }

    out.push(enclosingActive(stack) ? line : '');
  }

  if (stack.length > 0) {
    throw new LexError('Незакрытый #Если — нет #КонецЕсли', lines.length);
  }

  return out.join('\n');
}

/** Все ли уровни стека сейчас активны (текущая ветка). */
function enclosingActive(stack: IfFrame[], skipTop = 0): boolean {
  for (let i = 0; i < stack.length - skipTop; i += 1) {
    if (!stack[i].taken) return false;
  }
  return true;
}

function assertOpen(stack: IfFrame[], directive: string, line: number): void {
  if (stack.length === 0) {
    throw new LexError(`${directive} без открывающего #Если`, line);
  }
}

/** Убирает ведущее ключевое слово и хвостовое «Тогда», возвращает выражение. */
function stripKeyword(rest: string, keywords: string[]): string {
  const parts = rest.split(/\s+/);
  const first = parts[0].toLowerCase();
  if (!keywords.includes(first)) return rest;
  let expr = parts.slice(1).join(' ');
  // «Тогда» в конце
  const m = expr.match(/^(.*?)\s+(тогда|then)\s*$/i);
  if (m) expr = m[1];
  return expr.trim();
}

// ── Мини-парсер условия: `Клиент И (Сервер ИЛИ НЕ ВебКлиент)` ────────

function parseCondition(expr: string, line: number): boolean {
  const tokens = tokenizeCond(expr, line);
  let pos = 0;

  const value = (): boolean => {
    const t = tokens[pos++];
    if (t === undefined) throw new LexError('Ожидался операнд условия', line);
    if (t === '(') {
      const v = or();
      if (tokens[pos++] !== ')') throw new LexError('Ожидалась «)»', line);
      return v;
    }
    const key = t.toLowerCase();
    if (key === 'не' || key === 'not') return !value();
    return CONTEXT_SYMBOLS.has(key);
  };

  const and = (): boolean => {
    let left = value();
    while (tokens[pos]?.toLowerCase() === 'и' || tokens[pos]?.toLowerCase() === 'and') {
      pos += 1;
      left = value() && left;
    }
    return left;
  };

  const or = (): boolean => {
    let left = and();
    while (tokens[pos]?.toLowerCase() === 'или' || tokens[pos]?.toLowerCase() === 'or') {
      pos += 1;
      left = and() || left;
    }
    return left;
  };

  const result = or();
  if (pos < tokens.length) {
    throw new LexError(`Лишние токены в условии #Если: «${tokens.slice(pos).join(' ')}»`, line);
  }
  return result;
}

function tokenizeCond(expr: string, line: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ' || c === '\t') { i += 1; continue; }
    if (c === '(' || c === ')') { out.push(c); i += 1; continue; }
    if (/[a-zA-Zа-яА-Я_]/.test(c)) {
      let j = i;
      while (j < expr.length && /[a-zA-Zа-яА-Я_0-9]/.test(expr[j])) j += 1;
      out.push(expr.slice(i, j));
      i = j;
      continue;
    }
    throw new LexError(`Неожиданный символ в условии #Если: «${c}»`, line);
  }
  return out;
}
