import type { SyntaxEntry } from '../app/reference/types';

/**
 * Полная выгрузка СП с метаданными для дерева. Грузится один раз
 * (~660 КБ gzip), повторные вызовы — из кэша промиса.
 */
export interface FullReference {
  entries: SyntaxEntry[];
  /** Карта `имя_типа → catalog-сегменты пути` для построения дерева. */
  ownerPaths: Record<string, string[]>;
  /** Карта `catalog<N> → русское имя категории`. */
  categoryNames: Record<string, string>;
}

let cache: Promise<FullReference> | null = null;

export function loadFullReference(): Promise<FullReference> {
  if (!cache) {
    const url = `${import.meta.env.BASE_URL}reference/syntax-help-full.json`;
    cache = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Не удалось загрузить полную выгрузку (${r.status})`);
        return r.json() as Promise<FullReference>;
      })
      .then((d) => ({
        entries: d.entries,
        ownerPaths: d.ownerPaths ?? {},
        categoryNames: d.categoryNames ?? {},
      }));
  }
  return cache;
}

/**
 * id записи в полной выгрузке: для функций — просто `nameRu` (СокрЛП),
 * для методов/свойств — `owner.nameRu` (Массив.Добавить, ТабличныйДокумент.Записать).
 * Совместимо с курированной выгрузкой, чтобы потенциально шарить deep-link.
 */
export function entryId(e: SyntaxEntry): string {
  return e.kind === 'function' ? e.nameRu : `${e.owner}.${e.nameRu}`;
}
