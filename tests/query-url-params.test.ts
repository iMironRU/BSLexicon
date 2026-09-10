/** Контракт ссылок книги для /query/: q, gzq, source, title, embed (#56). */
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  decodeGzQueryParam,
  decodeQueryParam,
  encodeQueryParam,
  parseQueryUrlParams,
} from '../src/query-app/url-params';

const ЗАПРОС = 'ВЫБРАТЬ Наименование\nИЗ Справочник.Товары\nГДЕ НЕ ЭтоГруппа';

function gz(text: string): string {
  return gzipSync(Buffer.from(text, 'utf8'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('разбор параметров', () => {
  it('пустая строка — ничего не задано', () => {
    expect(parseQueryUrlParams('')).toEqual({ q: null, gzq: null, sourceUrl: null, title: null, embed: false });
  });

  it('q, source, title, embed', () => {
    const p = parseQueryUrlParams(
      `?q=${encodeQueryParam(ЗАПРОС)}&source=${encodeURIComponent('https://imiron.ru/1c-reading-queries/ch5')}&title=${encodeURIComponent('§ 5.4. Виртуальные таблицы')}&embed=1`,
    );
    expect(p.sourceUrl).toBe('https://imiron.ru/1c-reading-queries/ch5');
    expect(p.title).toBe('§ 5.4. Виртуальные таблицы');
    expect(p.embed).toBe(true);
    expect(decodeQueryParam(p.q!).text).toBe(ЗАПРОС);
  });

  it('embed выключается нулём и словом false', () => {
    expect(parseQueryUrlParams('?embed=0').embed).toBe(false);
    expect(parseQueryUrlParams('?embed=false').embed).toBe(false);
    expect(parseQueryUrlParams('?embed=yes').embed).toBe(true);
  });

  it('не-http источник игнорируется', () => {
    expect(parseQueryUrlParams('?source=javascript:alert(1)').sourceUrl).toBeNull();
    expect(parseQueryUrlParams('?source=' + encodeURIComponent('data:text/html,x')).sourceUrl).toBeNull();
    expect(parseQueryUrlParams('?source=не-адрес').sourceUrl).toBeNull();
  });
});

describe('запрос из ссылки', () => {
  it('туда и обратно', () => {
    expect(decodeQueryParam(encodeQueryParam(ЗАПРОС)).text).toBe(ЗАПРОС);
  });

  it('битый base64 объясняется словами', () => {
    const r = decodeQueryParam('!!!не-base64!!!');
    expect(r.text).toBe('');
    expect(r.error).toMatch(/не удалось разобрать/i);
  });

  it('gzq распаковывается', async () => {
    const r = await decodeGzQueryParam(gz(ЗАПРОС));
    expect(r.text).toBe(ЗАПРОС);
    expect(r.error).toBeNull();
  });

  it('gzq короче q на длинном запросе — ради QR', () => {
    const длинный = Array.from({ length: 40 }, (_, i) => `    Таблица.Поле${i},`).join('\n');
    expect(gz(длинный).length).toBeLessThan(encodeQueryParam(длинный).length);
  });

  it('битый gzq не роняет приложение', async () => {
    const r = await decodeGzQueryParam(encodeQueryParam('это не gzip'));
    expect(r.text).toBe('');
    expect(r.error).toMatch(/не удалось распаковать/i);
  });

  it('слишком большой запрос — предупреждение, но текст показан', () => {
    const огромный = 'ВЫБРАТЬ 1\n'.repeat(6000);
    const r = decodeQueryParam(encodeQueryParam(огромный));
    expect(r.text).toBe(огромный);
    expect(r.error).toMatch(/слишком большой/i);
  });
});
