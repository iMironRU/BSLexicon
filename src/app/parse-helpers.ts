/**
 * Общие хелперы для парсинга YAML/JSON в наши Result-возвращающие
 * функции. До этого модуля жили три почти одинаковые копии isObj/getStr/
 * ok/err в task-format.ts, book-format.ts, schema-loader.ts.
 *
 * `Result<T>` — договор всех parse-* модулей: либо ok c value, либо err с
 * сообщением для UI. Тип экспортируем — не тянуть его в каждый вызывающий
 * файл заново.
 */

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Универсальный error — параметр T оставляем `never` по умолчанию для callsites, где вывод типа сам разберётся. */
export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}

/** Тип-гвард: значение — plain object, не массив, не null. */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Строковое поле объекта или null. Пустая строка допустима. */
export function getStr(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' ? v : null;
}

/** Строковое поле, только если после trim непустое. */
export function getStrNonEmpty(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}
