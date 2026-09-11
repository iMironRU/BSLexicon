/**
 * История недавних карточек справочника. Храним до 10 последних `id`,
 * свежий — первым. localStorage — best-effort: в Safari Private или с
 * заблокированным storage просто работаем без истории.
 */
import { loadJson, saveJson } from '../app/local-store';

const KEY = 'bslexicon:help:recent';
const LIMIT = 10;

export function loadRecent(): string[] {
  const parsed = loadJson<unknown>(KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === 'string').slice(0, LIMIT);
}

export function pushRecent(id: string): string[] {
  const current = loadRecent();
  const next = [id, ...current.filter((x) => x !== id)].slice(0, LIMIT);
  saveJson(KEY, next);
  return next;
}
