/**
 * Прогресс читателя по задачам Judge. Плоская карта
 * `<book_id>:<task_id>` → { passedAt, solution }. Хранится в localStorage;
 * при недоступности storage — работаем без прогресса, но не падаем.
 */

const KEY = 'bslexicon:judge:progress';

export interface TaskProgress {
  /** Unix-ms момента, когда все тесты стали зелёными. */
  passedAt: number;
  /** Решение, которое сработало — восстанавливаем при возврате к задаче. */
  solution: string;
}

export type ProgressMap = Record<string, TaskProgress>;

function key(bookId: string, taskId: string): string {
  return `${bookId}:${taskId}`;
}

export function loadProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    // Best-effort: не валидируем каждый элемент — если кривой, UI просто
    // не покажет прогресс, но не упадёт.
    return parsed as ProgressMap;
  } catch {
    return {};
  }
}

export function markPassed(bookId: string, taskId: string, solution: string): ProgressMap {
  const now = Date.now();
  const map = loadProgress();
  map[key(bookId, taskId)] = { passedAt: now, solution };
  save(map);
  return map;
}

export function getProgress(map: ProgressMap, bookId: string, taskId: string): TaskProgress | null {
  return map[key(bookId, taskId)] ?? null;
}

/** Сохраняем черновик решения (даже неудачного) — чтобы читатель не терял код между визитами. */
export function saveDraft(bookId: string, taskId: string, solution: string): void {
  const map = loadProgress();
  const existing = map[key(bookId, taskId)];
  map[key(bookId, taskId)] = existing
    ? { ...existing, solution }
    : { passedAt: 0, solution }; // passedAt: 0 = не пройдено
  save(map);
}

function save(map: ProgressMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // ignore — Safari Private / переполнение quota
  }
}
