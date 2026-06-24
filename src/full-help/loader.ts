import type { SyntaxEntry } from '../app/reference/types';

/**
 * Ленивая загрузка полной выгрузки СП (~600 КБ gzip). Кэшируем промис —
 * подгружаем один раз; повторные вызовы возвращают тот же массив без
 * повторного network/parse.
 */
let cache: Promise<SyntaxEntry[]> | null = null;

export function loadFullReference(): Promise<SyntaxEntry[]> {
  if (!cache) {
    const url = `${import.meta.env.BASE_URL}reference/syntax-help-full.json`;
    cache = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Не удалось загрузить полную выгрузку (${r.status})`);
        return r.json() as Promise<{ entries: SyntaxEntry[] }>;
      })
      .then((d) => d.entries);
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
