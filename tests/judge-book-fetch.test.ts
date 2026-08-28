import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assetUrl,
  meetsMinVersion,
  parseRegistry,
  validateTasksJson,
  type BookRecord,
} from '../src/judge/book-fetch';

const schemaPath = fileURLToPath(new URL('../docs/book-integration/task-schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

function makeBook(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'book-a',
    repo: 'me/book-a',
    pinned_tag: 'nightly',
    enabled: true,
    ...overrides,
  };
}

function validTasksJson(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    version: 1,
    book: {
      id: 'book-a',
      title: 'Book A',
      version: '1.0.0',
      repo: 'me/book-a',
    },
    tasks: [
      {
        id: 't1',
        title: 'T1',
        chapter: 'ch1',
        statement: 'do it',
        starter: '',
        tests: [{ kind: 'stdout', expect: 'ok' }],
      },
    ],
    ...overrides,
  };
}

// ── parseRegistry ────────────────────────────────────────────────────

describe('parseRegistry', () => {
  it('парсит нормальный YAML', () => {
    const y = `
- id: a
  repo: me/a
  pinned_tag: v1
- id: b
  repo: me/b
  pinned_tag: nightly
  enabled: false
  min_version: "0.2"
`;
    const parsed = parseRegistry(y);
    expect(parsed).toEqual([
      { id: 'a', repo: 'me/a', pinned_tag: 'v1', enabled: true, min_version: undefined },
      { id: 'b', repo: 'me/b', pinned_tag: 'nightly', enabled: false, min_version: '0.2' },
    ]);
  });

  it('запись без обязательного поля → бросает с номером', () => {
    const y = `
- id: a
  repo: me/a
  pinned_tag: v1
- id: b
  pinned_tag: nightly
`;
    expect(() => parseRegistry(y)).toThrow(/#2.*id.*repo.*pinned_tag/);
  });

  it('не-массив → бросает', () => {
    expect(() => parseRegistry('foo: bar')).toThrow(/должен быть YAML-массивом/);
  });
});

// ── assetUrl ─────────────────────────────────────────────────────────

describe('assetUrl', () => {
  it('собирает прямую ссылку на релиз-ассет', () => {
    expect(assetUrl(makeBook())).toBe(
      'https://github.com/me/book-a/releases/download/nightly/tasks.json',
    );
  });

  it('экранирует тег с спецсимволами', () => {
    expect(assetUrl(makeBook({ pinned_tag: 'v/1.0' }))).toBe(
      'https://github.com/me/book-a/releases/download/v%2F1.0/tasks.json',
    );
  });
});

// ── meetsMinVersion ──────────────────────────────────────────────────

describe('meetsMinVersion', () => {
  it('точное совпадение → true', () => {
    expect(meetsMinVersion('1.0.0', '1.0.0')).toBe(true);
  });
  it('выше → true', () => {
    expect(meetsMinVersion('1.2.0', '1.0.0')).toBe(true);
    expect(meetsMinVersion('1.0.10', '1.0.2')).toBe(true);
    expect(meetsMinVersion('2.0', '1.99')).toBe(true);
  });
  it('ниже → false', () => {
    expect(meetsMinVersion('0.9.0', '1.0.0')).toBe(false);
    expect(meetsMinVersion('1.0.1', '1.0.2')).toBe(false);
  });
  it('короче считается недостающими нулями', () => {
    expect(meetsMinVersion('1', '1.0.0')).toBe(true);
    expect(meetsMinVersion('1.0', '1.0.1')).toBe(false);
  });
});

// ── validateTasksJson ────────────────────────────────────────────────

describe('validateTasksJson', () => {
  it('валидный tasks.json → возвращает типизированный объект', () => {
    const file = validateTasksJson(validTasksJson(), schema, makeBook());
    expect(file.version).toBe(1);
    expect(file.book.id).toBe('book-a');
    expect(file.tasks).toHaveLength(1);
  });

  it('битый JSON (missing tests) → бросает с деталями', () => {
    const bad = validTasksJson({
      tasks: [{ id: 't', title: 'x', chapter: 'ch', statement: 'y', starter: '' }],
    });
    expect(() => validateTasksJson(bad, schema, makeBook())).toThrow(/схеме/);
  });

  it('несовпадение book.id и реестра → бросает', () => {
    const wrong = validTasksJson({ book: { id: 'wrong', title: 't', version: '1.0.0', repo: 'x/y' } });
    expect(() => validateTasksJson(wrong, schema, makeBook())).toThrow(/book\.id.*не совпадает/);
  });

  it('min_version проверяется', () => {
    const old = validTasksJson({ book: { id: 'book-a', title: 't', version: '0.5.0', repo: 'me/book-a' } });
    expect(() =>
      validateTasksJson(old, schema, makeBook({ min_version: '1.0.0' })),
    ).toThrow(/min_version=1\.0\.0/);
  });

  it('version=2 (будущий формат) → бросает', () => {
    expect(() =>
      validateTasksJson(validTasksJson({ version: 2 }), schema, makeBook()),
    ).toThrow(/схеме/);
  });

  it('пустой tasks[] → бросает (minItems: 1)', () => {
    expect(() => validateTasksJson(validTasksJson({ tasks: [] }), schema, makeBook())).toThrow(
      /схеме/,
    );
  });

  it('kind: neither stdout nor call → бросает', () => {
    const weird = validTasksJson({
      tasks: [
        {
          id: 't',
          title: 'x',
          chapter: 'ch',
          statement: 'y',
          starter: '',
          tests: [{ kind: 'shell', expect: 'ok' }],
        },
      ],
    });
    expect(() => validateTasksJson(weird, schema, makeBook())).toThrow(/схеме/);
  });
});
