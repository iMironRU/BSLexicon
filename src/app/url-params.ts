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

export function parseSearchParams(search: string): ParsedUrlParams {
  const p = new URLSearchParams(search);
  const gzcode = p.get('gzcode') || null;
  const code = p.get('code') || null;
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

  const embed = embedRaw !== null && embedRaw !== '0' && embedRaw !== 'false';

  return { gzcode, code, sourceUrl, title, embed };
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
  writer.write(bytes);
  writer.close();

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
