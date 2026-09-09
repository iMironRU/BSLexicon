/**
 * Параметры запроса (#53).
 *
 * `&Имя` в тексте запроса — плейсхолдер, значение задаётся снаружи:
 *   - в песочнице `/query/` — панелью параметров рядом с редактором;
 *   - в query-ячейке ноутбука — в самом cell;
 *   - в задаче-запросе — в спеке через `parameters:`.
 *
 * Задача этого модуля — типизированный контейнер значений, преобразование
 * в `BslValue` для интерпретатора и сбор имён параметров из текста запроса.
 */
import type { BslValue } from '@core/index';
import { NULL } from '@core/interpreter/values';
import type { ParserRuleContext, TerminalNode } from 'antlr4ng';
import { ParameterContext } from './parser/generated/SDBLParser';
import { parseQuery } from './parser/parse';

/**
 * Тип и значение параметра. Хранится в UI и в сериализациях; на выходе
 * преобразуется в `BslValue` перед прогоном.
 *
 * Строка/число/булево — как задано пользователем.
 * Дата — ISO-без-TZ строка `2026-03-01T00:00:00` (в интерпретаторе так же
 * лежат даты полей — и сравнение, и `ДАТАВРЕМЯ(...)` дают этот формат).
 * Ссылка — короткий id из фикстуры (`n1`, `s_main`) плюс имя таблицы —
 * тип разыменования известен для валидации.
 * NULL — параметр «не задан» / явный NULL.
 */
export type QueryParamValue =
  | { kind: 'Строка'; value: string }
  | { kind: 'Число'; value: number }
  | { kind: 'Дата'; value: string /* ISO без TZ */ }
  | { kind: 'Булево'; value: boolean }
  | { kind: 'Ссылка'; refs: string /* Kind.Name */; value: string /* id */ }
  | { kind: 'NULL' };

/**
 * Пара «имя → значение» — так параметры хранятся в query-cell и в ссылке
 * поделиться. Массив, а не Map — чтобы легко сериализовать и держать
 * порядок отображения.
 */
export type QueryParamEntry = { name: string; value: QueryParamValue };

/** Пустое значение по умолчанию — «не задан». */
export const NULL_PARAM: QueryParamValue = { kind: 'NULL' };

/**
 * Преобразует значение параметра в BslValue для интерпретатора. NULL и
 * невалидные пути — в NULL (интерпретатор всё равно предупредит, если
 * параметр остался неиспользованным).
 */
export function toBslValue(v: QueryParamValue): BslValue {
  switch (v.kind) {
    case 'Строка': return v.value;
    case 'Число': return v.value;
    case 'Булево': return v.value;
    case 'Дата': return v.value;
    case 'Ссылка': return v.value;
    case 'NULL': return NULL;
  }
}

/**
 * Собирает все имена `&Имя`, встречающиеся в тексте запроса. Порядок —
 * порядок встречи в тексте (левый-верхний → правый-нижний). Дубликаты
 * удаляются, но порядок сохраняется от первой встречи.
 *
 * Если запрос не парсится — возвращаем пустой массив; UI покажет ошибку
 * парсера отдельно, панель параметров не должна ломать редактирование.
 */
export function extractParameterNames(source: string): string[] {
  const parsed = parseQuery(source);
  if (!parsed.ok) return [];
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (node: ParserRuleContext | TerminalNode): void => {
    if (isRule(node) && node instanceof ParameterContext) {
      const name = extractParamName(node);
      if (name && !seen.has(name)) {
        seen.add(name);
        order.push(name);
      }
      return;
    }
    if (isRule(node)) {
      const n = node.getChildCount();
      for (let i = 0; i < n; i += 1) {
        const c = node.getChild(i);
        if (c) visit(c as ParserRuleContext | TerminalNode);
      }
    }
  };
  visit(parsed.tree as ParserRuleContext);
  return order;
}

/** Собирает имя параметра из `ParameterContext` без ведущего `&`. */
export function extractParamName(pc: ParameterContext): string {
  const nameTok = pc._name;
  if (nameTok?.text) return nameTok.text;
  // fallback: getText() возвращает `&Имя` — обрежем амперсанд.
  const t = pc.getText();
  return t.startsWith('&') ? t.slice(1) : t;
}

function isRule(n: unknown): n is ParserRuleContext {
  return !!n && typeof (n as { getChildCount?: unknown }).getChildCount === 'function';
}

// ── сериализация ─────────────────────────────────────────────────

/**
 * Компактная сериализация значений — для URL и `.nb.json`. Формат:
 * `<kind>:<payload>`. Строки экранируются через encodeURIComponent.
 */
export function serializeParamValue(v: QueryParamValue): string {
  switch (v.kind) {
    case 'NULL': return 'null';
    case 'Строка': return `s:${encodeURIComponent(v.value)}`;
    case 'Число': return `n:${v.value}`;
    case 'Булево': return `b:${v.value ? '1' : '0'}`;
    case 'Дата': return `d:${v.value}`;
    case 'Ссылка': return `r:${encodeURIComponent(v.refs)}:${encodeURIComponent(v.value)}`;
  }
}

export function parseParamValue(s: string): QueryParamValue {
  if (s === 'null' || s === '') return NULL_PARAM;
  const [kind, ...rest] = s.split(':');
  const payload = rest.join(':');
  switch (kind) {
    case 's': return { kind: 'Строка', value: decodeURIComponent(payload) };
    case 'n': {
      const n = Number(payload);
      return Number.isFinite(n) ? { kind: 'Число', value: n } : NULL_PARAM;
    }
    case 'b': return { kind: 'Булево', value: payload === '1' };
    case 'd': return { kind: 'Дата', value: payload };
    case 'r': {
      const [refs, val] = payload.split(':');
      return { kind: 'Ссылка', refs: decodeURIComponent(refs ?? ''), value: decodeURIComponent(val ?? '') };
    }
    default: return NULL_PARAM;
  }
}
