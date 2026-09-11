/**
 * Контракт ссылок книги для песочницы запросов (#56).
 *
 * Те же параметры, что у тренажёра языка, только запрос вместо кода:
 *
 *   /query/?q=<base64>            запрос как есть
 *   /query/?gzq=<base64 gzip>     он же сжатый — для QR-кодов в печати
 *   &source=<url>&title=<текст>   откуда читатель пришёл
 *   &embed=1                      компактный вид для iframe
 *   &p.<имя>=<serialized>         значения параметров запроса (#26 в
 *                                  комментариях к #53): по одному
 *                                  URL-параметру на каждый `&Имя`.
 *                                  Формат serialized — тот же, что
 *                                  у serializeParamValue в parameters.ts
 *                                  (`s:…`, `n:…`, `b:…`, `d:…`,
 *                                  `r:refs:value`, `null`).
 *
 * Запрос, как и код в тренажёре, сам не выполняется: читатель нажимает
 * «Выполнить». Иначе ссылка из книги умела бы запускать чужую работу.
 */
import { decodeBase64, decompressGzip, parseBookParams, type BookParams } from '../app/url-params';
import { parseParamValue, serializeParamValue, type QueryParamEntry } from '../query/parameters';

const PARAM_PREFIX = 'p.';

/** Больше этого в ссылке не ждём: запрос — не выгрузка данных. */
const MAX_QUERY_BYTES = 50 * 1024;

export interface QueryUrlParams extends BookParams {
  /** `?q` — base64. */
  q: string | null;
  /** `?gzq` — base64 от gzip. Приоритетнее `q`, как `gzcode` над `code`. */
  gzq: string | null;
  /**
   * Разобранные `?p.Имя=…` — значения параметров запроса. Пусто, если
   * ссылка их не содержит. Порядок — как в URL.
   */
  parameters: QueryParamEntry[];
}

export interface DecodedQuery {
  /** null — параметра не было, показываем стартовый запрос. */
  text: string | null;
  /** Человеческое объяснение, если что-то не так. */
  error: string | null;
}

export function parseQueryUrlParams(search: string): QueryUrlParams {
  const p = new URLSearchParams(search);
  return {
    q: p.get('q') || null,
    gzq: p.get('gzq') || null,
    parameters: parseUrlParameters(p),
    ...parseBookParams(search),
  };
}

/**
 * Разбор `?p.Имя=<serialized>` → `QueryParamEntry[]`. Битые записи
 * (мусорный serialized) молча превращаются в NULL — параметр в панели
 * появится, читатель увидит, что для него нет значения, и запрос
 * отработает с warning'ом об отсутствующем параметре, а не тихо.
 * Дубликаты имён — берём последнее (стандартная семантика URL).
 */
function parseUrlParameters(p: URLSearchParams): QueryParamEntry[] {
  const byName = new Map<string, QueryParamEntry>();
  for (const [k, v] of p) {
    if (!k.startsWith(PARAM_PREFIX)) continue;
    const name = k.slice(PARAM_PREFIX.length);
    if (!name) continue;
    byName.set(name, { name, value: parseParamValue(v) });
  }
  return [...byName.values()];
}

/**
 * Обратный ход — для книги (и потенциальной кнопки share). Возвращает
 * массив пар `[ключ, значение]` — их можно передать в URLSearchParams
 * или собрать в URL самому. Не строит целиком URL и не префиксирует `?`,
 * потому что вызывающая сторона обычно уже собирает объект-URL.
 */
export function encodeParamsToUrl(entries: QueryParamEntry[]): [string, string][] {
  return entries.map((e) => [PARAM_PREFIX + e.name, serializeParamValue(e.value)]);
}

/** Синхронная часть: `?q`. `?gzq` требует распаковки и идёт отдельно. */
export function decodeQueryParam(raw: string): DecodedQuery {
  try {
    const text = decodeBase64(raw);
    return { text, error: oversized(text) };
  } catch {
    return { text: '', error: 'Не удалось разобрать запрос из ссылки.' };
  }
}

/** Асинхронная часть: `?gzq`. */
export async function decodeGzQueryParam(raw: string): Promise<DecodedQuery> {
  try {
    const text = await decompressGzip(raw);
    return { text, error: oversized(text) };
  } catch {
    return { text: '', error: 'Не удалось распаковать запрос из ссылки.' };
  }
}

/** Кодирование — тем же способом, каким книга собирает ссылку. */
export function encodeQueryParam(query: string): string {
  const bytes = new TextEncoder().encode(query);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function oversized(text: string): string | null {
  return text.length > MAX_QUERY_BYTES
    ? 'Запрос в ссылке слишком большой, возможна порча данных.'
    : null;
}
