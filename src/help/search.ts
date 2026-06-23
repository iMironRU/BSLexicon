import type { Catalog, CatalogEntry } from '@core/index';

/**
 * Чистый модуль поиска для Cmd+K overlay.
 *
 * Ранжирование: точное совпадение имени → совпадение с начала → совпадение
 * в середине имени → совпадение в описании. Регистр и язык (ru/en) не важны
 * (BSL регистронезависим, имена двуязычные).
 *
 * Не fuzzy в смысле Levenshtein — просто подстроки. Это honest signal: имя
 * либо начинается с запроса, либо нет. На объёме ~180 записей этого хватает,
 * а ложных хитов меньше, чем у fuzzy.
 */

export interface SearchHit {
  entry: CatalogEntry;
  /** Чем меньше — тем релевантнее (для сортировки). */
  score: number;
  /** Где зацепилось — для подсветки в UI. */
  match: 'exact-name' | 'name-start' | 'name-substr' | 'description';
  /** Индекс начала совпадения в `displayName(entry)` — `-1` если зацепилось в описании. */
  matchIndex: number;
}

/** Имя для отображения и сравнения: для метода/свойства — полное `Тип.Имя`. */
export function displayName(entry: CatalogEntry): string {
  return entry.id; // `СокрЛП` для функций, `Массив.Добавить` для методов
}

/**
 * Поиск в каталоге. Пустой запрос → пусто. Результаты обрезаются до `limit`.
 */
export function search(catalog: Catalog, queryRaw: string, limit = 50): SearchHit[] {
  const q = queryRaw.trim().toLowerCase();
  if (q === '') return [];

  const hits: SearchHit[] = [];
  for (const entry of catalog.entries) {
    const hit = scoreEntry(entry, q);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => a.score - b.score || displayName(a.entry).localeCompare(displayName(b.entry), 'ru'));
  return hits.slice(0, limit);
}

function scoreEntry(entry: CatalogEntry, q: string): SearchHit | null {
  const ru = entry.names.ru.toLowerCase();
  const en = entry.names.en.toLowerCase();
  const id = entry.id.toLowerCase();

  // exact name (ru / en / id)
  if (ru === q || en === q || id === q) {
    return { entry, score: 0, match: 'exact-name', matchIndex: 0 };
  }

  // name starts with
  if (ru.startsWith(q) || id.startsWith(q)) {
    return { entry, score: 100, match: 'name-start', matchIndex: 0 };
  }
  if (en.startsWith(q)) {
    return { entry, score: 110, match: 'name-start', matchIndex: -1 };
  }

  // name contains
  const ruIdx = ru.indexOf(q);
  if (ruIdx !== -1) {
    return { entry, score: 200 + ruIdx, match: 'name-substr', matchIndex: ruIdx };
  }
  const idIdx = id.indexOf(q);
  if (idIdx !== -1) {
    return { entry, score: 220 + idIdx, match: 'name-substr', matchIndex: idIdx };
  }
  const enIdx = en.indexOf(q);
  if (enIdx !== -1) {
    return { entry, score: 240 + enIdx, match: 'name-substr', matchIndex: -1 };
  }

  // description
  const descLower = (entry.description ?? '').toLowerCase();
  const descIdx = descLower.indexOf(q);
  if (descIdx !== -1) {
    return { entry, score: 1000 + descIdx, match: 'description', matchIndex: -1 };
  }

  return null;
}
