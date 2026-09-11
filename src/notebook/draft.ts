/**
 * Автосохранение notebook'а в localStorage (см. #25).
 *
 * Один слот `bslexicon:notebook:draft` — последнее состояние ноутбука
 * пользователя. Пишется дебаунсом из App.tsx на каждое изменение.
 * Приоритет при загрузке: URL `?nb=` > draft > starter.
 *
 * Формат — JSON (не gzip): черновик хранится локально, места хватает,
 * а parsing нужен на каждой инициализации — простая строка быстрее.
 * URL-shareable форма (gzip+base64) — отдельно в serialize.ts.
 *
 * Сериализация ячеек — через `cell-codec.ts` (общий для draft / URL / git),
 * тут остаётся только обёртка над localStorage и defaults.
 *
 * Battery: если localStorage недоступен (Safari Private, кросс-домен
 * блокировка) — вся логика превращается в no-op, ноутбук продолжает
 * работать без сохранения. Никаких исключений.
 */

import type { Cell, Notebook } from './types';
import { fromStored, toStored, type DecodeDefaults, type StoredCell } from './cell-codec';
import { DEFAULT_QUERY_TASK, DEFAULT_TASK, EMPTY_QUERY_DATA, EMPTY_QUERY_SCHEMA } from './cell-defaults';

const KEY = 'bslexicon:notebook:draft';

interface StoredNotebook {
  v: 1;
  cells: StoredCell[];
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `d${idCounter}`;
}

const DEFAULTS: DecodeDefaults = {
  task: DEFAULT_TASK,
  queryTask: DEFAULT_QUERY_TASK,
  querySchema: EMPTY_QUERY_SCHEMA,
  queryData: EMPTY_QUERY_DATA,
};

export function saveDraft(nb: Notebook): void {
  try {
    const payload: StoredNotebook = { v: 1, cells: nb.cells.map(toStored) };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* storage недоступен — молча игнорируем */
  }
}

/**
 * Возвращает сохранённый notebook или null. При битом JSON / неверной
 * схеме тоже null (не бросаем): фолбэк на starter — предсказуемее
 * чем «пустой экран с ошибкой».
 */
export function loadDraft(): Notebook | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredNotebook;
    if (parsed.v !== 1 || !Array.isArray(parsed.cells)) return null;
    const cells: Cell[] = parsed.cells.map((c) => fromStored(c, nextId, DEFAULTS));
    return { cells };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
