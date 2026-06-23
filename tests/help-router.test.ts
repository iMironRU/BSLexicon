import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from '../src/help/router';

describe('parseHash', () => {
  it('пустой хеш / # / #/ → home', () => {
    expect(parseHash('')).toEqual({ kind: 'home' });
    expect(parseHash('#')).toEqual({ kind: 'home' });
    expect(parseHash('#/')).toEqual({ kind: 'home' });
  });

  it('тип: #/type/Массив', () => {
    expect(parseHash('#/type/Массив')).toEqual({ kind: 'entry', entryKind: 'type', id: 'Массив' });
  });

  it('кириллица URL-кодированная → декодируется', () => {
    const hash = `#/type/${encodeURIComponent('Массив')}`;
    expect(parseHash(hash)).toEqual({ kind: 'entry', entryKind: 'type', id: 'Массив' });
  });

  it('метод с точкой в id', () => {
    const hash = `#/method/${encodeURIComponent('Массив.Добавить')}`;
    expect(parseHash(hash)).toEqual({
      kind: 'entry',
      entryKind: 'method',
      id: 'Массив.Добавить',
    });
  });

  it('неизвестный kind → not-found', () => {
    expect(parseHash('#/garbage/x')).toEqual({ kind: 'not-found', raw: '#/garbage/x' });
  });

  it('невалидный percent-encoding → not-found, не падает', () => {
    expect(parseHash('#/type/%E0%A4')).toEqual({ kind: 'not-found', raw: '#/type/%E0%A4' });
  });
});

describe('formatHash', () => {
  it('home → #/', () => {
    expect(formatHash({ kind: 'home' })).toBe('#/');
  });

  it('тип / функция кодируется', () => {
    expect(formatHash({ kind: 'entry', entryKind: 'type', id: 'Массив' })).toBe(
      `#/type/${encodeURIComponent('Массив')}`,
    );
    expect(formatHash({ kind: 'entry', entryKind: 'function', id: 'СокрЛП' })).toBe(
      `#/function/${encodeURIComponent('СокрЛП')}`,
    );
  });

  it('метод с точкой', () => {
    expect(formatHash({ kind: 'entry', entryKind: 'method', id: 'Массив.Добавить' })).toBe(
      `#/method/${encodeURIComponent('Массив.Добавить')}`,
    );
  });
});

describe('roundtrip parseHash → formatHash', () => {
  const samples: string[] = [
    '#/',
    `#/type/${encodeURIComponent('Массив')}`,
    `#/function/${encodeURIComponent('СокрЛП')}`,
    `#/method/${encodeURIComponent('Массив.Добавить')}`,
    `#/property/${encodeURIComponent('ТаблицаЗначений.Колонки')}`,
  ];
  for (const s of samples) {
    it(`сохраняет «${s}»`, () => {
      expect(formatHash(parseHash(s))).toBe(s);
    });
  }
});
