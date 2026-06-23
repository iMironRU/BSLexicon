/**
 * История недавних карточек справочника. Храним до 10 последних `id`,
 * свежий — первым. localStorage — best-effort: в Safari Private или с
 * заблокированным storage просто работаем без истории.
 */

const KEY = 'bslexicon:help:recent';
const LIMIT = 10;

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function pushRecent(id: string): string[] {
  const current = loadRecent();
  const next = [id, ...current.filter((x) => x !== id)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage недоступен — молча игнорируем, история не критична
  }
  return next;
}
