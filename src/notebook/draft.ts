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
 * Battery: если localStorage недоступен (Safari Private, кросс-домен
 * блокировка) — вся логика превращается в no-op, ноутбук продолжает
 * работать без сохранения. Никаких исключений.
 */

import type { Cell, Notebook, TaskSpec } from './types';

const KEY = 'bslexicon:notebook:draft';

interface StoredCell {
  t: 'md' | 'code' | 'task';
  s: string;
  task?: TaskSpec;
}

interface StoredNotebook {
  v: 1;
  cells: StoredCell[];
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `d${idCounter}`;
}

export function saveDraft(nb: Notebook): void {
  try {
    const payload: StoredNotebook = {
      v: 1,
      cells: nb.cells.map((c) => {
        if (c.type === 'task') return { t: 'task', s: c.source, task: c.task };
        return { t: c.type === 'markdown' ? 'md' : 'code', s: c.source };
      }),
    };
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
    const cells: Cell[] = parsed.cells.map((c) => {
      if (c.t === 'task' && c.task) {
        return { id: nextId(), type: 'task', source: c.s, task: c.task };
      }
      if (c.t === 'md') return { id: nextId(), type: 'markdown', source: c.s };
      return { id: nextId(), type: 'code', source: c.s };
    });
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
