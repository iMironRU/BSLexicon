/**
 * Загрузка и индексация каталога языка для синтакс-помощника и панели-справочника.
 *
 * Чистый модуль без привязки к фреймворку и файловой системе: на вход — сырые
 * YAML-строки (их добывает край: Vite-glob в браузере, fs в тестах/скриптах),
 * на выходе — индексы для провайдеров автодополнения/hover/signature help.
 */
import { load } from 'js-yaml';
import type { CatalogEntry } from './types';

export interface Catalog {
  /** Все записи в порядке загрузки. */
  entries: CatalogEntry[];
  /** Глобальные функции (`kind: function`). */
  functions: CatalogEntry[];
  /** Типы (`kind: type`). */
  types: CatalogEntry[];
  /** Методы типов (`kind: method`). */
  methods: CatalogEntry[];
  /** Запись по `id`: `СокрЛП`, `Массив`, `Массив.Добавить`. */
  byId: Map<string, CatalogEntry>;
  /** Функция по имени в нижнем регистре (ru и en) — BSL регистронезависим. */
  functionByName: Map<string, CatalogEntry>;
  /** Методы по имени типа: «Массив» → [Добавить, Количество, …]. */
  methodsByType: Map<string, CatalogEntry[]>;
  /**
   * Любые записи по имени в нижнем регистре (ru и en). Значение — массив:
   * одно имя бывает у нескольких записей (метод повторяется у разных типов;
   * «Строка» — и тип, и функция-конвертация). Для hover/signature help.
   */
  byName: Map<string, CatalogEntry[]>;
}

/** Имя типа, к которому относится метод: «Массив.Добавить» → «Массив». */
export function methodTypeOf(id: string): string {
  const dot = id.indexOf('.');
  return dot === -1 ? '' : id.slice(0, dot);
}

/** Разбирает сырые YAML-файлы каталога в плоский список записей. */
export function parseCatalog(rawFiles: string[]): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const raw of rawFiles) {
    const data = load(raw);
    if (Array.isArray(data)) entries.push(...(data as CatalogEntry[]));
  }
  return entries;
}

/** Строит индексы каталога поверх плоского списка записей. */
export function buildCatalog(entries: CatalogEntry[]): Catalog {
  const functions = entries.filter((e) => e.kind === 'function');
  const types = entries.filter((e) => e.kind === 'type');
  const methods = entries.filter((e) => e.kind === 'method');

  const byId = new Map<string, CatalogEntry>();
  for (const e of entries) byId.set(e.id, e);

  const functionByName = new Map<string, CatalogEntry>();
  for (const fn of functions) {
    functionByName.set(fn.names.ru.toLowerCase(), fn);
    functionByName.set(fn.names.en.toLowerCase(), fn);
  }

  const methodsByType = new Map<string, CatalogEntry[]>();
  for (const m of methods) {
    const type = methodTypeOf(m.id);
    const list = methodsByType.get(type);
    if (list) list.push(m);
    else methodsByType.set(type, [m]);
  }

  const byName = new Map<string, CatalogEntry[]>();
  const indexName = (name: string, entry: CatalogEntry): void => {
    const key = name.toLowerCase();
    const list = byName.get(key);
    if (list) list.push(entry);
    else byName.set(key, [entry]);
  };
  for (const e of entries) {
    indexName(e.names.ru, e);
    if (e.names.en.toLowerCase() !== e.names.ru.toLowerCase()) indexName(e.names.en, e);
  }

  return { entries, functions, types, methods, byId, functionByName, methodsByType, byName };
}

/** Удобная обёртка: сырые YAML-файлы → индексированный каталог. */
export function loadCatalogFrom(rawFiles: string[]): Catalog {
  return buildCatalog(parseCatalog(rawFiles));
}
