/**
 * Контракт ссылок книги для песочницы запросов (#56).
 *
 * Те же параметры, что у тренажёра языка, только запрос вместо кода:
 *
 *   /query/?q=<base64>            запрос как есть
 *   /query/?gzq=<base64 gzip>     он же сжатый — для QR-кодов в печати
 *   &source=<url>&title=<текст>   откуда читатель пришёл
 *   &embed=1                      компактный вид для iframe
 *
 * Запрос, как и код в тренажёре, сам не выполняется: читатель нажимает
 * «Выполнить». Иначе ссылка из книги умела бы запускать чужую работу.
 */
import { decodeBase64, decompressGzip, parseBookParams, type BookParams } from '../app/url-params';

/** Больше этого в ссылке не ждём: запрос — не выгрузка данных. */
const MAX_QUERY_BYTES = 50 * 1024;

export interface QueryUrlParams extends BookParams {
  /** `?q` — base64. */
  q: string | null;
  /** `?gzq` — base64 от gzip. Приоритетнее `q`, как `gzcode` над `code`. */
  gzq: string | null;
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
    ...parseBookParams(search),
  };
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
