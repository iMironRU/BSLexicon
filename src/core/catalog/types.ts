/**
 * Канонические типы записей каталога языка (`catalog/*.yaml`).
 * Форма-источник правды — `catalog/schema.json`; здесь её TypeScript-зеркало,
 * общее для рантайм-проверки (scripts/check-catalog.ts) и синтакс-помощника.
 */

export type CatalogKind = 'function' | 'type' | 'method' | 'property';

export interface CatalogNames {
  /** Русское имя (как пишут в коде: `СокрЛП`, `Добавить`). */
  ru: string;
  /** Английский синоним (`TrimAll`, `Add`). */
  en: string;
}

export interface CatalogParam {
  name: string;
  type: string;
  optional?: boolean;
  default?: unknown;
  description?: string;
}

export interface CatalogReturns {
  type: string;
  description?: string;
}

export interface CatalogExample {
  title?: string;
  code: string;
  /** Ожидаемый вывод — прогоняется как doctest в CI. */
  expect?: string;
}

export interface CatalogEntry {
  /** Уникальный идентификатор: `СокрЛП`, `Массив`, `Массив.Добавить`. */
  id: string;
  kind: CatalogKind;
  names: CatalogNames;
  category: string;
  signature?: string;
  description: string;
  params?: CatalogParam[];
  returns?: CatalogReturns;
  examples?: CatalogExample[];
}
