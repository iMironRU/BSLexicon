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

/** Колбэк прогресса: получено байт / всего байт (или `null`, если сервер
 *  не отдал Content-Length — тогда показываем индетерминированный спиннер). */
export type ProgressFn = (loaded: number, total: number | null) => void;

let cache: Promise<FullReference> | null = null;
/** Подписчики, ждущие прогресс ещё-не-завершённой первой загрузки. */
const progressSubs = new Set<ProgressFn>();

export function loadFullReference(onProgress?: ProgressFn): Promise<FullReference> {
  if (onProgress) progressSubs.add(onProgress);
  if (!cache) {
    const url = `${import.meta.env.BASE_URL}reference/syntax-help-full.json`;
    cache = fetchWithProgress(url, (l, t) => {
      for (const fn of progressSubs) fn(l, t);
    })
      .then((d) => ({
        entries: d.entries,
        ownerPaths: d.ownerPaths ?? {},
        categoryNames: d.categoryNames ?? {},
      }))
      .finally(() => progressSubs.clear());
  }
  return cache;
}

/**
 * fetch JSON со стримом и прогрессом. Если `Content-Length` есть —
 * шлём (loaded, total); иначе шлём (loaded, null) и UI рисует индетерминированный.
 * При отсутствии ReadableStream (старые браузеры) — фолбэк на обычный r.json().
 */
async function fetchWithProgress(url: string, onProgress: ProgressFn): Promise<FullReference> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Не удалось загрузить полную выгрузку (${r.status})`);
  const total = parseTotal(r.headers.get('Content-Length'));

  if (!r.body) return (await r.json()) as FullReference;

  const reader = r.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  // Финальный сигнал «100%», чтобы UI успел отрисовать перед парсингом
  onProgress(loaded, total ?? loaded);

  const text = await new Blob(chunks).text();
  return JSON.parse(text) as FullReference;
}

function parseTotal(header: string | null): number | null {
  if (!header) return null;
  const n = Number(header);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * id записи в полной выгрузке: для функций — просто `nameRu` (СокрЛП),
 * для методов/свойств — `owner.nameRu` (Массив.Добавить, ТабличныйДокумент.Записать).
 * Совместимо с курированной выгрузкой, чтобы потенциально шарить deep-link.
 */
export function entryId(e: SyntaxEntry): string {
  return e.kind === 'function' ? e.nameRu : `${e.owner}.${e.nameRu}`;
}
