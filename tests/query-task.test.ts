import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQueryTaskYaml, type QueryTaskSpec } from '../src/query/task-format';
import { runQueryTask } from '../src/query/task-runner';
import { NULL } from '../src/core/interpreter/values';

const schemaYaml = readFileSync(join(__dirname, '../examples/query-demo/mini-erp.schema.yaml'), 'utf8');
const dataYaml = readFileSync(join(__dirname, '../examples/query-demo/mini-erp.data.yaml'), 'utf8');

/** Мини-спека на mini-erp: выведи Наименование складов, сортировка не важна. */
const UNORDERED_SPEC: QueryTaskSpec = {
  statement: 'Выведи наименования складов.',
  starter: 'ВЫБРАТЬ Наименование ИЗ Справочник.Склады',
  schema: schemaYaml,
  data: dataYaml,
  expected: {
    kind: 'unordered',
    columns: ['Наименование'],
    rows: [['Основной'], ['Восточный']],
  },
};

const ORDERED_SPEC: QueryTaskSpec = {
  statement: 'Выведи наименования складов по возрастанию.',
  starter: '',
  schema: schemaYaml,
  data: dataYaml,
  expected: {
    kind: 'ordered',
    columns: ['Наименование'],
    rows: [['Восточный'], ['Основной']],
  },
};

describe('runQueryTask', () => {
  it('pass — правильный запрос, unordered', () => {
    const r = runQueryTask('ВЫБРАТЬ Наименование ИЗ Справочник.Склады', UNORDERED_SPEC);
    expect(r.status).toBe('pass');
    expect(r.diff?.reason).toBeNull();
  });

  it('pass — тот же результат в обратном порядке для unordered', () => {
    const r = runQueryTask(
      'ВЫБРАТЬ Наименование ИЗ Справочник.Склады УПОРЯДОЧИТЬ ПО Наименование УБЫВ',
      UNORDERED_SPEC,
    );
    expect(r.status).toBe('pass');
  });

  it('fail — ordered: порядок важен', () => {
    // Запрос без сортировки в общем случае может дать неправильный порядок;
    // для нашего интерпретатора он совпадает с порядком записей — Основной, Восточный.
    // Ожидаем ordered [Восточный, Основной] — не совпадёт.
    const r = runQueryTask('ВЫБРАТЬ Наименование ИЗ Справочник.Склады', ORDERED_SPEC);
    expect(r.status).toBe('fail');
    expect(r.diff?.rows.firstMismatch).toBe(0);
  });

  it('pass — ordered после УПОРЯДОЧИТЬ ПО', () => {
    const r = runQueryTask(
      'ВЫБРАТЬ Наименование ИЗ Справочник.Склады УПОРЯДОЧИТЬ ПО Наименование',
      ORDERED_SPEC,
    );
    expect(r.status).toBe('pass');
  });

  it('fail — другие колонки', () => {
    const r = runQueryTask('ВЫБРАТЬ Код ИЗ Справочник.Склады', UNORDERED_SPEC);
    expect(r.status).toBe('fail');
    expect(r.diff?.columns.match).toBe(false);
    expect(r.diff?.reason).toMatch(/Колонки/);
  });

  it('fail — больше строк, чем в эталоне', () => {
    const r = runQueryTask('ВЫБРАТЬ Наименование ИЗ Справочник.Номенклатура', UNORDERED_SPEC);
    expect(r.status).toBe('fail');
    expect(r.diff?.reason).toMatch(/Число строк/);
  });

  it('error — синтаксическая ошибка в запросе ученика', () => {
    const r = runQueryTask('ВЫБРАТЬ ,', UNORDERED_SPEC);
    expect(r.status).toBe('error');
    expect(r.errors?.some((e) => e.stage === 'parser')).toBe(true);
  });

  it('error — битая схема в spec', () => {
    const bad: QueryTaskSpec = { ...UNORDERED_SPEC, schema: 'version: 1\n:: не yaml ::' };
    const r = runQueryTask('ВЫБРАТЬ 1', bad);
    expect(r.status).toBe('error');
    expect(r.specError).toMatch(/Схема/);
  });

  it('строгое различение NULL / 0 / ""', () => {
    const spec: QueryTaskSpec = {
      statement: 'edge',
      starter: '',
      schema: schemaYaml,
      data: dataYaml,
      expected: {
        kind: 'ordered',
        columns: ['Наименование'],
        rows: [[NULL]],
      },
    };
    // Запрос вернёт строку "Основной" — не NULL.
    const r = runQueryTask('ВЫБРАТЬ ПЕРВЫЕ 1 Наименование ИЗ Справочник.Склады', spec);
    expect(r.status).toBe('fail');
  });

  it('числа сравниваются по значению (Число(15,3) == Число(2))', () => {
    const spec: QueryTaskSpec = {
      statement: 'sum',
      starter: '',
      schema: schemaYaml,
      data: dataYaml,
      expected: {
        kind: 'ordered',
        columns: ['Всего'],
        rows: [[8]],
      },
    };
    const r = runQueryTask('ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК Всего ИЗ Справочник.Номенклатура', spec);
    expect(r.status).toBe('pass');
  });
});

// ── YAML parser ──────────────────────────────────────────────────

describe('parseQueryTaskYaml', () => {
  const validYaml = `
title: Все товары
statement: |
  Выведи Наименование.
starter: |
  ВЫБРАТЬ Наименование
  ИЗ Справочник.Номенклатура
schema: |
  version: 1
  tables:
    - kind: Справочник
      name: Номенклатура
      fields:
        - { name: Ссылка, type: УникальныйИдентификатор, key: true }
        - { name: Наименование, type: Строка(50) }
data: |
  version: 1
  records:
    Справочник.Номенклатура:
      - { Ссылка: n1, Наименование: Молоток }
expected:
  columns: [Наименование]
  rows_unordered:
    - [Молоток]
hints:
  - Первый шаг — выбрать одну колонку.
`;

  it('parseQueryTaskYaml: успешный кейс', () => {
    const r = parseQueryTaskYaml(validYaml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('Все товары');
    expect(r.value.expected.kind).toBe('unordered');
    expect(r.value.expected.columns).toEqual(['Наименование']);
    expect(r.value.expected.rows).toEqual([['Молоток']]);
    expect(r.value.hints?.length).toBe(1);
  });

  it('parseQueryTaskYaml: rows_ordered тоже поддерживается', () => {
    const y = validYaml.replace('rows_unordered', 'rows_ordered');
    const r = parseQueryTaskYaml(y);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.expected.kind).toBe('ordered');
  });

  it('parseQueryTaskYaml: оба rows_ordered и rows_unordered — ошибка', () => {
    const y = validYaml.replace(
      'rows_unordered:\n    - [Молоток]',
      'rows_unordered:\n    - [Молоток]\n  rows_ordered:\n    - [x]',
    );
    const r = parseQueryTaskYaml(y);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/либо.*либо/);
  });

  it('parseQueryTaskYaml: без expected — ошибка', () => {
    const bad = validYaml.replace(/expected:[\s\S]*hints:/, 'hints:');
    const r = parseQueryTaskYaml(bad);
    expect(r.ok).toBe(false);
  });

  it('parseQueryTaskYaml: битый YAML → понятная ошибка', () => {
    const r = parseQueryTaskYaml('foo:\n :');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/YAML|обязательно/i);
  });
});
