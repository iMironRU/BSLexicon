import type { SyntaxEntry } from '../app/reference/types';
import { entryId } from './loader';

/**
 * Поиск по полной выгрузке (~20 тыс. записей). Регекс по подстроке —
 * простой и понятный сигнал. На 20k записей выполнение ≤30мс на
 * современном железе, без воркеров.
 */
export interface FullHit {
  entry: SyntaxEntry;
  score: number;
  match: 'exact' | 'prefix' | 'substr';
  matchIndex: number; // позиция в id для подсветки; -1 если зацепилось не в id
}

export function search(entries: readonly SyntaxEntry[], queryRaw: string, limit = 100): FullHit[] {
  const q = queryRaw.trim().toLowerCase();
  if (q === '') return [];
  const hits: FullHit[] = [];

  for (const e of entries) {
    const id = entryId(e);
    const idL = id.toLowerCase();
    const ru = e.nameRu.toLowerCase();
    const en = e.nameEn.toLowerCase();

    if (ru === q || en === q || idL === q) {
      hits.push({ entry: e, score: 0, match: 'exact', matchIndex: idL.indexOf(q) });
      continue;
    }
    if (ru.startsWith(q) || idL.startsWith(q)) {
      hits.push({ entry: e, score: 100, match: 'prefix', matchIndex: idL.indexOf(q) });
      continue;
    }
    if (en.startsWith(q)) {
      hits.push({ entry: e, score: 110, match: 'prefix', matchIndex: -1 });
      continue;
    }
    const ruIdx = ru.indexOf(q);
    if (ruIdx !== -1) {
      hits.push({ entry: e, score: 200 + ruIdx, match: 'substr', matchIndex: idL.indexOf(q) });
      continue;
    }
    const idIdx = idL.indexOf(q);
    if (idIdx !== -1) {
      hits.push({ entry: e, score: 220 + idIdx, match: 'substr', matchIndex: idIdx });
      continue;
    }
    const enIdx = en.indexOf(q);
    if (enIdx !== -1) {
      hits.push({ entry: e, score: 240 + enIdx, match: 'substr', matchIndex: -1 });
      continue;
    }
  }

  hits.sort((a, b) => a.score - b.score || entryId(a.entry).localeCompare(entryId(b.entry), 'ru'));
  return hits.slice(0, limit);
}
