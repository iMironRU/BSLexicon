/** Контракт ссылок книги для /query/: q, gzq, source, title, embed (#56). */
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  decodeGzQueryParam,
  decodeQueryParam,
  encodeParamsToUrl,
  encodeQueryParam,
  parseQueryUrlParams,
} from '../src/query-app/url-params';
import type { QueryParamEntry } from '../src/query/parameters';

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
    expect(parseQueryUrlParams('')).toEqual({ q: null, gzq: null, parameters: [], sourceUrl: null, title: null, embed: false });
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

describe('значения параметров запроса из ссылки (p.Имя=…)', () => {
  function buildSearch(entries: QueryParamEntry[]): string {
    const usp = new URLSearchParams();
    for (const [k, v] of encodeParamsToUrl(entries)) usp.append(k, v);
    return '?' + usp.toString();
  }

  it('пустая ссылка — пустой массив параметров', () => {
    expect(parseQueryUrlParams('?q=x').parameters).toEqual([]);
  });

  it('строковый параметр', () => {
    const entries: QueryParamEntry[] = [{ name: 'Товар', value: { kind: 'Строка', value: 'Молоток' } }];
    expect(parseQueryUrlParams(buildSearch(entries)).parameters).toEqual(entries);
  });

  it('дата, число, булево — round-trip', () => {
    const entries: QueryParamEntry[] = [
      { name: 'НаДату', value: { kind: 'Дата', value: '2024-01-15T00:00:00' } },
      { name: 'Порог', value: { kind: 'Число', value: 100 } },
      { name: 'ТолькоПродажи', value: { kind: 'Булево', value: true } },
    ];
    expect(parseQueryUrlParams(buildSearch(entries)).parameters).toEqual(entries);
  });

  it('ссылка (kind=Ссылка) round-trip с refs и id', () => {
    const entries: QueryParamEntry[] = [
      { name: 'Склад', value: { kind: 'Ссылка', refs: 'Справочник.Склады', value: 's_main' } },
    ];
    expect(parseQueryUrlParams(buildSearch(entries)).parameters).toEqual(entries);
  });

  it('NULL параметр через null-строку', () => {
    expect(parseQueryUrlParams('?p.НетДаты=null').parameters).toEqual([
      { name: 'НетДаты', value: { kind: 'NULL' } },
    ]);
  });

  it('битое значение — параметр появляется как NULL (без падения)', () => {
    expect(parseQueryUrlParams('?p.X=мусор:без:префикса').parameters).toEqual([
      { name: 'X', value: { kind: 'NULL' } },
    ]);
  });

  it('дубликат имени — берём последнее', () => {
    const s = '?p.A=n:1&p.A=n:2';
    expect(parseQueryUrlParams(s).parameters).toEqual([{ name: 'A', value: { kind: 'Число', value: 2 } }]);
  });

  it('порядок сохраняется', () => {
    const s = '?p.Второй=n:2&p.Первый=n:1';
    expect(parseQueryUrlParams(s).parameters.map((e) => e.name)).toEqual(['Второй', 'Первый']);
  });

  it('пустое имя после префикса игнорируется', () => {
    expect(parseQueryUrlParams('?p.=n:1').parameters).toEqual([]);
  });

  it('строка со спецсимволами & = + % пробел — round-trip', () => {
    // encodeURIComponent внутри serializeParamValue + URLSearchParams снаружи
    // не должны сложиться в двойное кодирование или потерять символы (проверка
    // по просьбе книжной сессии, у которой в текстах параграфов таких значений
    // нет, но в чужих сценариях могут появиться).
    const entries: QueryParamEntry[] = [
      { name: 'Строка', value: { kind: 'Строка', value: 'a=b&c+d%e ф' } },
    ];
    expect(parseQueryUrlParams(buildSearch(entries)).parameters).toEqual(entries);
  });

  it('NULL через encodeParamsToUrl — round-trip', () => {
    // Проверка симметрии: то, что пишет наш собственный сериализатор,
    // всегда должно читаться нашим же парсером.
    const entries: QueryParamEntry[] = [{ name: 'Пусто', value: { kind: 'NULL' } }];
    expect(parseQueryUrlParams(buildSearch(entries)).parameters).toEqual(entries);
  });

  it('живёт рядом с q, source, title, embed', () => {
    const p = parseQueryUrlParams(
      `?q=${encodeQueryParam(ЗАПРОС)}&p.Склад=r:${encodeURIComponent('Справочник.Склады')}:s_main&source=${encodeURIComponent('https://example.com/x')}&embed=1`,
    );
    expect(p.parameters).toEqual([
      { name: 'Склад', value: { kind: 'Ссылка', refs: 'Справочник.Склады', value: 's_main' } },
    ]);
    expect(decodeQueryParam(p.q!).text).toBe(ЗАПРОС);
    expect(p.embed).toBe(true);
  });
});
