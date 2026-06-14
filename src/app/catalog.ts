import { loadCatalogFrom } from '@core/index';
import type { Catalog } from '@core/index';

/**
 * Загрузка каталога языка в браузере. YAML-файлы из `catalog/` импортируются
 * как сырой текст через Vite glob (eager, на этапе сборки) — тот же единый
 * источник правды, что и для рантайма, без отдельного шага кодогенерации.
 */
const rawFiles = import.meta.glob('/catalog/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

let cached: Catalog | null = null;

/** Индексированный каталог; строится один раз за сессию (каталог статичен). */
export function loadCatalog(): Catalog {
  if (!cached) cached = loadCatalogFrom(Object.values(rawFiles));
  return cached;
}
