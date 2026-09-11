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
import { loadJson, removeKey, saveJson } from '../app/local-store';
import { fromStored, toStored, type DecodeDefaults, type StoredNotebook } from './cell-codec';
import { DEFAULT_QUERY_TASK, DEFAULT_TASK, EMPTY_QUERY_DATA, EMPTY_QUERY_SCHEMA } from './cell-defaults';

const KEY = 'bslexicon:notebook:draft';

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
  const payload: StoredNotebook = { v: 1, cells: nb.cells.map(toStored) };
  saveJson(KEY, payload);
}

/**
 * Возвращает сохранённый notebook или null. При битом JSON / неверной
 * схеме тоже null (не бросаем): фолбэк на starter — предсказуемее
 * чем «пустой экран с ошибкой».
 */
export function loadDraft(): Notebook | null {
  const parsed = loadJson<StoredNotebook>(KEY);
  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.cells)) return null;
  const cells: Cell[] = parsed.cells.map((c) => fromStored(c, nextId, DEFAULTS));
  return { cells };
}

export function clearDraft(): void {
  removeKey(KEY);
}
