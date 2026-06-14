import type { SyntaxEntry } from './types';

/**
 * Ленивая загрузка датасета справочника из public/reference/ (с учётом base-пути
 * Pages). Кэшируем промис — грузим один раз при первом открытии панели.
 */
let cache: Promise<SyntaxEntry[]> | null = null;

export function loadReference(): Promise<SyntaxEntry[]> {
  if (!cache) {
    const url = `${import.meta.env.BASE_URL}reference/syntax-help.json`;
    cache = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Не удалось загрузить справочник (${r.status})`);
        return r.json() as Promise<{ entries: SyntaxEntry[] }>;
      })
      .then((d) => d.entries);
  }
  return cache;
}
