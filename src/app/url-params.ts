const MAX_CODE_BYTES = 50 * 1024;

export type CodeDecodeResult =
  | { ok: true; code: string; oversized: boolean }
  | { ok: false; error: string };

export interface ParsedUrlParams {
  gzcode: string | null;
  code: string | null;
  sourceUrl: string | null;
  title: string | null;
  embed: boolean;
}

/** Часть контракта, общая для тренажёра и песочницы запросов: откуда пришли и как показывать. */
export interface BookParams {
  sourceUrl: string | null;
  title: string | null;
  embed: boolean;
}

/**
 * `?source`, `?title`, `?embed` — одинаково для всех тренажёров.
 * Не-http источник игнорируется молча: подсунутый `javascript:` не должен
 * попасть в `href`.
 */
export function parseBookParams(search: string): BookParams {
  const p = new URLSearchParams(search);
  const sourceRaw = p.get('source') || null;
  const title = p.get('title') || null;
  const embedRaw = p.get('embed');

  let sourceUrl: string | null = null;
  if (sourceRaw) {
    try {
      const url = new URL(sourceRaw);
      if (url.protocol === 'http:' || url.protocol === 'https:') sourceUrl = sourceRaw;
    } catch {
      // невалидный URL → игнорируем
    }
  }

  return { sourceUrl, title, embed: embedRaw !== null && embedRaw !== '0' && embedRaw !== 'false' };
}

export function parseSearchParams(search: string): ParsedUrlParams {
  const p = new URLSearchParams(search);
  return {
    gzcode: p.get('gzcode') || null,
    code: p.get('code') || null,
    ...parseBookParams(search),
  };
}

/** Декодирует URL-safe base64 → UTF-8 строку. Бросает исключение при невалидных данных. */
export function decodeBase64(raw: string): string {
  const std = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const binStr = atob(padded);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Распаковывает gzip, закодированный в URL-safe base64. Возвращает UTF-8 строку. */
export async function decompressGzip(raw: string): Promise<string> {
  const std = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const binStr = atob(padded);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  // Битые данные роняют обе стороны потока. Ошибку читателя ловит
  // вызывающий, а отказ писателя иначе всплыл бы как unhandled rejection.
  void writer.write(bytes).catch(() => {});
  void writer.close().catch(() => {});

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(merged);
}

/** Синхронно декодирует параметр ?code. */
export function decodeCodeParam(raw: string): CodeDecodeResult {
  try {
    const code = decodeBase64(raw);
    return { ok: true, code, oversized: code.length > MAX_CODE_BYTES };
  } catch {
    return { ok: false, error: 'Не удалось декодировать код из ссылки' };
  }
}

/**
 * Кодирует исходник в URL-safe base64 (для параметра `?code=…`).
 * Симметричен `decodeBase64` ↔ `decodeCodeParam`.
 */
export function encodeCodeParam(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let binStr = '';
  for (const b of bytes) binStr += String.fromCharCode(b);
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Сжимает UTF-8 строку в URL-safe base64(gzip). Симметрично `decompressGzip`.
 * Используется для `?gzcode`, `?gzq`, `?nb=` — везде, где сырой размер
 * может съесть URL-лимит браузера.
 */
export async function compressGzip(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }

  let bin = '';
  for (const b of merged) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
