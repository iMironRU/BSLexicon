import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseDataYaml,
  parseFieldType,
  parseSchemaYaml,
  validateFixture,
} from '../src/query/schema-loader';

const DEMO_SCHEMA = readFileSync(
  join(__dirname, '../examples/query-demo/mini-erp.schema.yaml'),
  'utf8',
);
const DEMO_DATA = readFileSync(
  join(__dirname, '../examples/query-demo/mini-erp.data.yaml'),
  'utf8',
);

describe('parseFieldType', () => {
  it('Дата / Булево / УникальныйИдентификатор', () => {
    expect(parseFieldType('Дата')).toEqual({ ok: true, value: { kind: 'Дата' } });
    expect(parseFieldType('Булево')).toEqual({ ok: true, value: { kind: 'Булево' } });
    expect(parseFieldType('УникальныйИдентификатор').ok).toBe(true);
  });

  it('Строка без длины', () => {
    expect(parseFieldType('Строка')).toEqual({ ok: true, value: { kind: 'Строка' } });
  });

  it('Строка(9) → length: 9', () => {
    const r = parseFieldType('Строка(9)');
    expect(r).toEqual({ ok: true, value: { kind: 'Строка', length: 9 } });
  });

  it('Число(15,3) → digits: 15, fraction: 3', () => {
    const r = parseFieldType('Число(15,3)');
    expect(r).toEqual({ ok: true, value: { kind: 'Число', digits: 15, fraction: 3 } });
  });

  it('Число(10) → digits без fraction', () => {
    const r = parseFieldType('Число(10)');
    expect(r).toEqual({ ok: true, value: { kind: 'Число', digits: 10 } });
  });

  it('Ссылка без refs → error', () => {
    const r = parseFieldType('Ссылка');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/refs/i);
  });

  it('Ссылка с refs', () => {
    const r = parseFieldType('Ссылка', 'Справочник.Номенклатура');
    expect(r).toEqual({ ok: true, value: { kind: 'Ссылка', refs: 'Справочник.Номенклатура' } });
  });

  it('неизвестный тип → error', () => {
    expect(parseFieldType('НетТакого').ok).toBe(false);
  });
});

describe('parseSchemaYaml — базовые ошибки', () => {
  it('пустая строка → error', () => {
    expect(parseSchemaYaml('').ok).toBe(false);
  });
  it('неверная версия → error', () => {
    expect(parseSchemaYaml('version: 2\ntables: []').ok).toBe(false);
  });
  it('без tables → error', () => {
    expect(parseSchemaYaml('version: 1').ok).toBe(false);
  });
  it('пустой tables → error', () => {
    expect(parseSchemaYaml('version: 1\ntables: []').ok).toBe(false);
  });
  it('неизвестный kind → error', () => {
    const r = parseSchemaYaml('version: 1\ntables:\n  - { kind: НетТакого, name: X }');
    expect(r.ok).toBe(false);
  });
  it('дубликат таблицы → error', () => {
    const src = `
version: 1
tables:
  - { kind: Справочник, name: X, fields: [{ name: Ссылка, type: УникальныйИдентификатор, key: true }] }
  - { kind: Справочник, name: X, fields: [{ name: Ссылка, type: УникальныйИдентификатор, key: true }] }
`;
    const r = parseSchemaYaml(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/дважды/);
  });
  it('дубликат поля внутри таблицы → error', () => {
    const src = `
version: 1
tables:
  - kind: Справочник
    name: X
    fields:
      - { name: А, type: Строка(1) }
      - { name: А, type: Строка(1) }
`;
    expect(parseSchemaYaml(src).ok).toBe(false);
  });
});

describe('parseSchemaYaml — регистры', () => {
  it('РегистрНакопления без view → error', () => {
    const src = `
version: 1
tables:
  - kind: РегистрНакопления
    name: R
    dimensions: []
    resources: []
`;
    const r = parseSchemaYaml(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/view/i);
  });

  it('РегистрСведений без periodic → error', () => {
    const src = `
version: 1
tables:
  - kind: РегистрСведений
    name: R
    dimensions: []
    resources: []
`;
    expect(parseSchemaYaml(src).ok).toBe(false);
  });

  it('РегистрНакопления с dimensions + resources — ok', () => {
    const src = `
version: 1
tables:
  - kind: РегистрНакопления
    name: R
    view: Остатки
    dimensions:
      - { name: Склад, type: Ссылка, refs: Справочник.Склады }
    resources:
      - { name: Количество, type: "Число(15,3)" }
`;
    const r = parseSchemaYaml(src);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tables).toHaveLength(1);
      const t = r.value.tables[0];
      if (t.kind === 'РегистрНакопления') {
        expect(t.view).toBe('Остатки');
        expect(t.dimensions).toHaveLength(1);
        expect(t.resources).toHaveLength(1);
      }
    }
  });
});

describe('demo mini-ERP', () => {
  it('schema парсится без ошибок', () => {
    const r = parseSchemaYaml(DEMO_SCHEMA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Ожидаем все объекты из §4.4
      const refs = r.value.tables.map((t) => `${t.kind}.${t.name}`);
      expect(refs).toContain('Справочник.Номенклатура');
      expect(refs).toContain('Справочник.Контрагенты');
      expect(refs).toContain('Справочник.Склады');
      expect(refs).toContain('Документ.РасходнаяНакладная');
      expect(refs).toContain('РегистрНакопления.ОстаткиТоваров');
      expect(refs).toContain('РегистрСведений.ЦеныНоменклатуры');
    }
  });

  it('Номенклатура помечена как hierarchical', () => {
    const r = parseSchemaYaml(DEMO_SCHEMA);
    if (r.ok) {
      const n = r.value.tables.find((t) => t.kind === 'Справочник' && t.name === 'Номенклатура');
      expect(n).toBeDefined();
      if (n && n.kind === 'Справочник') expect(n.hierarchical).toBe(true);
    }
  });

  it('РасходнаяНакладная имеет табличную часть Товары с 4 полями', () => {
    const r = parseSchemaYaml(DEMO_SCHEMA);
    if (r.ok) {
      const d = r.value.tables.find((t) => t.kind === 'Документ' && t.name === 'РасходнаяНакладная');
      expect(d).toBeDefined();
      if (d && d.kind === 'Документ') {
        expect(d.tabular).toBeDefined();
        expect(d.tabular![0].name).toBe('Товары');
        expect(d.tabular![0].fields).toHaveLength(4);
      }
    }
  });

  it('РегистрСведений.ЦеныНоменклатуры — периодический', () => {
    const r = parseSchemaYaml(DEMO_SCHEMA);
    if (r.ok) {
      const t = r.value.tables.find((t) => t.kind === 'РегистрСведений');
      expect(t).toBeDefined();
      if (t && t.kind === 'РегистрСведений') expect(t.periodic).toBe(true);
    }
  });

  it('data парсится без ошибок', () => {
    const r = parseDataYaml(DEMO_DATA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value.records)).toContain('Справочник.Номенклатура');
      expect(Object.keys(r.value.records)).toContain('РегистрНакопления.ОстаткиТоваров');
    }
  });

  it('data валидируется против schema', () => {
    const s = parseSchemaYaml(DEMO_SCHEMA);
    const d = parseDataYaml(DEMO_DATA);
    expect(s.ok && d.ok).toBe(true);
    if (s.ok && d.ok) {
      const v = validateFixture(s.value, d.value);
      expect(v.ok).toBe(true);
    }
  });

  it('data с неизвестной таблицей → validate error', () => {
    const s = parseSchemaYaml(DEMO_SCHEMA);
    if (s.ok) {
      const badData = { version: 1 as const, records: { 'Справочник.НетТакого': [] } };
      const v = validateFixture(s.value, badData);
      expect(v.ok).toBe(false);
    }
  });
});

describe('parseDataYaml', () => {
  it('без version → error', () => {
    expect(parseDataYaml('records: {}').ok).toBe(false);
  });
  it('records не объект → error', () => {
    expect(parseDataYaml('version: 1\nrecords: [1, 2]').ok).toBe(false);
  });
  it('записи не массив → error', () => {
    expect(parseDataYaml('version: 1\nrecords:\n  Справочник.X: 5').ok).toBe(false);
  });
});
