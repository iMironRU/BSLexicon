/** База по ссылке: разбор параметров, загрузка, ошибки, кэш (#55). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRemoteFixture, readFixtureSource, type FetchLike, type TextStore } from '../src/query-app/remote-fixture';

const SCHEMA = readFileSync('examples/query-demo/mini-erp.schema.yaml', 'utf8');
const DATA = readFileSync('examples/query-demo/mini-erp.data.yaml', 'utf8');

const S = 'https://example.org/base/schema.yaml';
const D = 'https://example.org/base/data.yaml';

function fetcher(map: { [url: string]: string | number }, log?: string[]): FetchLike {
  return (url: string) => {
    log?.push(url);
    const v = map[url];
    if (typeof v === 'number') return Promise.resolve({ ok: false, status: v, text: () => Promise.resolve('') });
    if (v === undefined) return Promise.reject(new Error('сеть недоступна'));
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(v) });
  };
}

function memoryStore(): TextStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('readFixtureSource', () => {
  it('без параметров — встроенная база', () => {
    expect(readFixtureSource('')).toEqual({ origin: { kind: 'встроенная' } });
  });

  it('обе ссылки — база по ссылке', () => {
    const r = readFixtureSource(`?schema-src=${encodeURIComponent(S)}&data-src=${encodeURIComponent(D)}`);
    expect(r.origin).toEqual({ kind: 'по ссылке', schemaUrl: S, dataUrl: D });
    expect(r.error).toBeUndefined();
  });

  it('половина параметров — встроенная и объяснение', () => {
    const r = readFixtureSource(`?schema-src=${encodeURIComponent(S)}`);
    expect(r.origin.kind).toBe('встроенная');
    expect(r.error).toMatch(/оба параметра/i);
  });

  it('не-http схема отклоняется', () => {
    const r = readFixtureSource('?schema-src=javascript:alert(1)&data-src=' + encodeURIComponent(D));
    expect(r.origin.kind).toBe('встроенная');
    expect(r.error).toMatch(/http/i);
  });
});

describe('loadRemoteFixture', () => {
  it('собирает базу и говорит, откуда она', async () => {
    const r = await loadRemoteFixture(S, D, { fetchImpl: fetcher({ [S]: SCHEMA, [D]: DATA }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixture.schema.tables.length).toBeGreaterThan(0);
    expect(r.origin).toEqual({ kind: 'по ссылке', schemaUrl: S, dataUrl: D });
  });

  it('404 объясняется словами', async () => {
    const r = await loadRemoteFixture(S, D, { fetchImpl: fetcher({ [S]: 404, [D]: DATA }) });
    expect(r).toEqual({ ok: false, error: expect.stringContaining('404') });
  });

  it('сетевая ошибка не роняет приложение', async () => {
    const r = await loadRemoteFixture(S, D, { fetchImpl: fetcher({}) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/не удалось загрузить/i);
  });

  it('битый YAML схемы', async () => {
    const r = await loadRemoteFixture(S, D, { fetchImpl: fetcher({ [S]: 'version: 1\ntables: [ {', [D]: DATA }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/схема не разобралась/i);
  });

  it('данные не по схеме', async () => {
    const чужие = 'version: 1\nrecords:\n  Справочник.Выдуманный:\n    - { Ссылка: x1 }\n';
    const r = await loadRemoteFixture(S, D, { fetchImpl: fetcher({ [S]: SCHEMA, [D]: чужие }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/не соответствуют схеме/i);
  });

  it('второй заход берёт из кэша, а не из сети', async () => {
    const log: string[] = [];
    const store = memoryStore();
    const f = fetcher({ [S]: SCHEMA, [D]: DATA }, log);
    await loadRemoteFixture(S, D, { fetchImpl: f, store });
    expect(log).toHaveLength(2);
    await loadRemoteFixture(S, D, { fetchImpl: f, store });
    expect(log).toHaveLength(2);
  });
});
