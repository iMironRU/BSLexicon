/**
 * Тонкая обёртка над `localStorage` с одинаковой обработкой недоступности.
 * До этого модуля один и тот же `try / localStorage.getItem / JSON.parse /
 * catch → null` копипастился в трёх местах (draft-ноутбука, snippets
 * тренажёра, judge-progress) — и в каждом чуть по-разному.
 *
 * Battery / Safari Private / кросс-домен: любой отказ localStorage
 * превращаем в no-op (запись) либо `null` (чтение). Приложение всегда
 * работает; сохранения между сессиями просто нет.
 */

/** JSON-payload по ключу. Битый / несовместимый — null. */
export function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Записывает JSON-строкой. При отказе storage — молчаливый no-op. */
export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage недоступен — игнорируем */
  }
}

/** Сырая строка по ключу. При недоступном storage — null. */
export function loadString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Записывает сырую строку. При отказе — no-op. */
export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no-op */
  }
}

/** Удаляет ключ. При отказе — no-op. */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}
