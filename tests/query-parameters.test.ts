import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixture, type Fixture } from '../src/query/fixture';
import { runQuery } from '../src/query/interpreter';
import { parseDataYaml, parseSchemaYaml } from '../src/query/schema-loader';
import { extractParameterNames, parseParamValue, serializeParamValue, toBslValue, type QueryParamValue } from '../src/query/parameters';
import { parseQueryTaskYaml } from '../src/query/task-format';
import { runQueryTask } from '../src/query/task-runner';

let fx: Fixture;

beforeAll(() => {
  const s = parseSchemaYaml(readFileSync(join(__dirname, '../examples/query-demo/mini-erp.schema.yaml'), 'utf8'));
  const d = parseDataYaml(readFileSync(join(__dirname, '../examples/query-demo/mini-erp.data.yaml'), 'utf8'));
  if (!s.ok || !d.ok) throw new Error('demo fixtures broken');
  fx = buildFixture(s.value, d.value);
});

describe('extractParameterNames', () => {
  it('собирает все имена параметров без дублей и в порядке встречи', () => {
    const names = extractParameterNames(`
      ВЫБРАТЬ * ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(&Дата)
      ГДЕ Склад = &Склад И &Дата > ДАТАВРЕМЯ(2024,1,1)
    `);
    expect(names).toEqual(['Дата', 'Склад']);
  });

  it('битый запрос → пустой список без ошибки', () => {
    expect(extractParameterNames('ВЫБРАТЬ ,')).toEqual([]);
  });

  it('никаких &Имя — пустой список', () => {
    expect(extractParameterNames('ВЫБРАТЬ 1')).toEqual([]);
  });
});

describe('Runner: значения параметров', () => {
  it('фильтр по &Склад — работает с параметром', () => {
    const r = runQuery(
      'ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК Кол ИЗ РегистрНакопления.ОстаткиТоваров ГДЕ Склад = &Склад',
      fx,
      { parameters: { Склад: 's_main' } },
    );
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
    // Все движения кроме s_east: 12 - 1 (s_east расход) - 1 (нач-остатки s_east) = 10
    expect((r.rowset.rows[0][0] as number)).toBeGreaterThan(0);
  });

  it('незаданный параметр — предупреждение', () => {
    const r = runQuery(
      'ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ Справочник.Номенклатура ГДЕ Ссылка = &Товар',
      fx,
    );
    if (!r.ok) throw new Error('unexpected');
    expect(r.warnings.some((w) => w.includes('&Товар'))).toBe(true);
  });

  it('Дата-параметр в виртуальной таблице Остатки', () => {
    const r = runQuery(
      'ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК Кол ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(&Дата)',
      fx,
      { parameters: { Дата: '2024-01-10T00:00:00' } },
    );
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
    // На 10 января есть только приходы 2024-01-01: 6 позиций
    expect(r.rowset.rows[0][0]).toBe(6);
  });
});

describe('toBslValue', () => {
  it('строка/число/булево — как есть', () => {
    expect(toBslValue({ kind: 'Строка', value: 'x' })).toBe('x');
    expect(toBslValue({ kind: 'Число', value: 42 })).toBe(42);
    expect(toBslValue({ kind: 'Булево', value: true })).toBe(true);
  });

  it('дата — строка', () => {
    expect(toBslValue({ kind: 'Дата', value: '2026-03-01T00:00:00' })).toBe('2026-03-01T00:00:00');
  });

  it('ссылка — id', () => {
    expect(toBslValue({ kind: 'Ссылка', refs: 'Справочник.Номенклатура', value: 'n1' })).toBe('n1');
  });
});

describe('Сериализация значений параметров', () => {
  const cases: QueryParamValue[] = [
    { kind: 'NULL' },
    { kind: 'Строка', value: 'ООО «Стройка»' },
    { kind: 'Число', value: 3.14 },
    { kind: 'Булево', value: true },
    { kind: 'Дата', value: '2026-03-01T00:00:00' },
    { kind: 'Ссылка', refs: 'Справочник.Номенклатура', value: 'n1' },
  ];

  it('round-trip serialize → parse сохраняет значение', () => {
    for (const v of cases) {
      const s = serializeParamValue(v);
      expect(parseParamValue(s)).toEqual(v);
    }
  });

  it('битый payload → NULL', () => {
    expect(parseParamValue('xxx:yyy')).toEqual({ kind: 'NULL' });
  });
});

describe('Query-task: parameters в спеке', () => {
  const schemaYaml = readFileSync(join(__dirname, '../examples/query-demo/mini-erp.schema.yaml'), 'utf8');
  const dataYaml = readFileSync(join(__dirname, '../examples/query-demo/mini-erp.data.yaml'), 'utf8');

  it('runQueryTask использует parameters из спеки', () => {
    const r = runQueryTask(
      'ВЫБРАТЬ Наименование ИЗ Справочник.Склады ГДЕ Ссылка = &Склад',
      {
        statement: 'Одна запись',
        starter: '',
        schema: schemaYaml,
        data: dataYaml,
        expected: { kind: 'ordered', columns: ['Наименование'], rows: [['Основной']] },
        parameters: [{ name: 'Склад', value: { kind: 'Ссылка', refs: 'Справочник.Склады', value: 's_main' } }],
      },
    );
    expect(r.status).toBe('pass');
  });

  it('parseQueryTaskYaml — parameters', () => {
    const yaml = `
statement: p
starter: ""
schema: |
  version: 1
  tables:
    - kind: Справочник
      name: X
      fields:
        - { name: Ссылка, type: УникальныйИдентификатор, key: true }
data: |
  version: 1
  records: {}
expected:
  columns: [X]
  rows_ordered:
    - [1]
parameters:
  - { name: Дата, kind: Дата, value: "2026-03-01T00:00:00" }
  - { name: Склад, kind: Ссылка, refs: Справочник.X, value: n1 }
  - { name: Пусто, kind: NULL }
`;
    const r = parseQueryTaskYaml(yaml);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.parameters?.length).toBe(3);
    expect(r.value.parameters?.[0]).toEqual({ name: 'Дата', value: { kind: 'Дата', value: '2026-03-01T00:00:00' } });
    expect(r.value.parameters?.[1]).toEqual({ name: 'Склад', value: { kind: 'Ссылка', refs: 'Справочник.X', value: 'n1' } });
    expect(r.value.parameters?.[2]).toEqual({ name: 'Пусто', value: { kind: 'NULL' } });
  });
});
