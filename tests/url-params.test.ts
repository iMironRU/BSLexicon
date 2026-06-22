import { describe, expect, it } from 'vitest';
import { decodeBase64, decodeCodeParam, parseSearchParams } from '../src/app/url-params';

// Кодирует строку в URL-safe base64 (как будет делать книга)
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binStr = '';
  for (const b of bytes) binStr += String.fromCharCode(b);
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

describe('parseSearchParams', () => {
  it('нет параметров → всё null/false', () => {
    const r = parseSearchParams('');
    expect(r).toEqual({ gzcode: null, code: null, sourceUrl: null, title: null, embed: false });
  });

  it('?code=abc', () => {
    const r = parseSearchParams('?code=abc');
    expect(r.code).toBe('abc');
    expect(r.gzcode).toBeNull();
  });

  it('пустой ?code= трактуется как отсутствие', () => {
    expect(parseSearchParams('?code=').code).toBeNull();
  });

  it('?gzcode приоритетнее ?code (оба присутствуют)', () => {
    const r = parseSearchParams('?gzcode=gz&code=plain');
    expect(r.gzcode).toBe('gz');
    expect(r.code).toBe('plain');
  });

  it('?source=https://example.com → валидный URL', () => {
    expect(parseSearchParams('?source=https://example.com').sourceUrl).toBe('https://example.com');
  });

  it('?source=http://example.com → принимается', () => {
    expect(parseSearchParams('?source=http://example.com').sourceUrl).toBe('http://example.com');
  });

  it('?source с javascript: → игнорируется', () => {
    expect(parseSearchParams('?source=javascript:alert(1)').sourceUrl).toBeNull();
  });

  it('?source с data: → игнорируется', () => {
    expect(parseSearchParams('?source=data:text/html,hi').sourceUrl).toBeNull();
  });

  it('невалидный ?source → null', () => {
    expect(parseSearchParams('?source=not-a-url').sourceUrl).toBeNull();
  });

  it('?title декодируется URLSearchParams автоматически', () => {
    expect(parseSearchParams('?title=%D0%9A%D0%BD%D0%B8%D0%B3%D0%B0').title).toBe('Книга');
  });

  it('?embed=1 → true', () => expect(parseSearchParams('?embed=1').embed).toBe(true));
  it('?embed=true → true', () => expect(parseSearchParams('?embed=true').embed).toBe(true));
  it('?embed=yes → true', () => expect(parseSearchParams('?embed=yes').embed).toBe(true));
  it('?embed=0 → false', () => expect(parseSearchParams('?embed=0').embed).toBe(false));
  it('?embed=false → false', () => expect(parseSearchParams('?embed=false').embed).toBe(false));
  it('?embed без значения → true', () => expect(parseSearchParams('?embed').embed).toBe(true));
});

describe('decodeBase64', () => {
  it('латиница', () => {
    const b64 = encodeBase64('hello');
    expect(decodeBase64(b64)).toBe('hello');
  });

  it('кириллица (BSL)', () => {
    const src = 'Сообщить("Привет");';
    expect(decodeBase64(encodeBase64(src))).toBe(src);
  });

  it('URL-safe символ - (вместо +) декодируется корректно', () => {
    // 'Сообщить' → стандартный base64 содержит +
    const src = 'Сообщить';
    const standard = 'base64' in Buffer
      ? Buffer.from(new TextEncoder().encode(src)).toString('base64')
      : btoa(String.fromCharCode(...new TextEncoder().encode(src)));
    expect(standard).toContain('+'); // гарантируем, что + присутствует
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    expect(urlSafe).toContain('-');
    expect(decodeBase64(urlSafe)).toBe(src);
  });

  it('невалидный base64 → исключение', () => {
    expect(() => decodeBase64('!!!невалидный!!!')).toThrow();
  });
});

describe('decodeCodeParam', () => {
  it('валидный код → ok:true', () => {
    const code = 'Сообщить(1 + 2);';
    const r = decodeCodeParam(encodeBase64(code));
    expect(r).toEqual({ ok: true, code, oversized: false });
  });

  it('невалидный base64 → ok:false с сообщением', () => {
    const r = decodeCodeParam('!!!');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('декодировать');
  });

  it('код >50КБ → ok:true, oversized:true', () => {
    const big = 'а'.repeat(51 * 1024);
    const r = decodeCodeParam(encodeBase64(big));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.oversized).toBe(true);
      expect(r.code).toBe(big);
    }
  });
});
