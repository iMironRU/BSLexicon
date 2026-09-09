import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixture, type Fixture } from '../src/query/fixture';
import { runQuery } from '../src/query/interpreter';
import { parseDataYaml, parseSchemaYaml } from '../src/query/schema-loader';

let fx: Fixture;

beforeAll(() => {
  const schemaYaml = readFileSync(join(__dirname, '../examples/query-demo/mini-erp.schema.yaml'), 'utf8');
  const dataYaml = readFileSync(join(__dirname, '../examples/query-demo/mini-erp.data.yaml'), 'utf8');
  const s = parseSchemaYaml(schemaYaml);
  const d = parseDataYaml(dataYaml);
  if (!s.ok || !d.ok) throw new Error('demo fixtures broken');
  fx = buildFixture(s.value, d.value);
});

/** Утилита: прогон запроса, ожидаем ok, возвращаем rowset. */
function run(source: string) {
  const r = runQuery(source, fx);
  if (!r.ok) throw new Error(`Ошибки:\n${r.errors.map((e) => `[${e.stage}] ${e.message}`).join('\n')}\nЗапрос:\n${source}`);
  return r.rowset;
}

describe('SELECT минимум', () => {
  it('одиночное поле', () => {
    const r = run('ВЫБРАТЬ Наименование ИЗ Справочник.Номенклатура');
    expect(r.columns).toEqual(['Наименование']);
    expect(r.rows.length).toBe(8); // все номенклатуры включая группы
    expect(r.rows.map((r) => r[0])).toContain('Молоток');
  });

  it('поле с алиасом КАК', () => {
    const r = run('ВЫБРАТЬ Наименование КАК Имя ИЗ Справочник.Контрагенты');
    expect(r.columns).toEqual(['Имя']);
    expect(r.rows.length).toBe(3);
  });

  it('несколько полей', () => {
    const r = run('ВЫБРАТЬ Код, Наименование ИЗ Справочник.Склады');
    expect(r.columns).toEqual(['Код', 'Наименование']);
    expect(r.rows.length).toBe(2);
  });
});

describe('WHERE', () => {
  it('простое равенство с булевым', () => {
    const r = run('ВЫБРАТЬ Наименование ИЗ Справочник.Номенклатура ГДЕ ПометкаУдаления = ИСТИНА');
    expect(r.rows.length).toBe(1);
    expect(r.rows[0][0]).toBe('Устаревшая позиция');
  });

  it('условие И/ИЛИ', () => {
    const r = run(`
      ВЫБРАТЬ Наименование ИЗ Справочник.Номенклатура
      ГДЕ ПометкаУдаления = ЛОЖЬ И (Код = "000000003" ИЛИ Код = "000000004")
    `);
    expect(r.rows.length).toBe(2);
  });
});

describe('УПОРЯДОЧИТЬ ПО', () => {
  it('по возрастанию (по умолчанию)', () => {
    const r = run('ВЫБРАТЬ Наименование ИЗ Справочник.Склады УПОРЯДОЧИТЬ ПО Наименование');
    expect(r.rows[0][0]).toBe('Восточный');
    expect(r.rows[1][0]).toBe('Основной');
  });

  it('по убыванию', () => {
    const r = run('ВЫБРАТЬ Наименование ИЗ Справочник.Склады УПОРЯДОЧИТЬ ПО Наименование УБЫВ');
    expect(r.rows[0][0]).toBe('Основной');
    expect(r.rows[1][0]).toBe('Восточный');
  });
});

describe('Агрегаты без GROUP BY', () => {
  it('КОЛИЧЕСТВО(*)', () => {
    const r = run('ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК Кол ИЗ Справочник.Номенклатура');
    expect(r.rows.length).toBe(1);
    expect(r.rows[0][0]).toBe(8);
  });

  it('СУММА по табличной части (пока: движения регистра как строки)', () => {
    const r = run('ВЫБРАТЬ СУММА(Количество) КАК ВсегоКол ИЗ РегистрНакопления.ОстаткиТоваров');
    expect(r.rows.length).toBe(1);
    expect(typeof r.rows[0][0]).toBe('number');
    expect(r.rows[0][0]).toBeGreaterThan(0);
  });
});

describe('GROUP BY', () => {
  it('группировка + СУММА', () => {
    const r = run(`
      ВЫБРАТЬ Склад, СУММА(Количество) КАК Итог
      ИЗ РегистрНакопления.ОстаткиТоваров
      СГРУППИРОВАТЬ ПО Склад
    `);
    expect(r.rows.length).toBe(2); // 2 склада
  });
});

describe('Ошибки', () => {
  it('неизвестная таблица → runtime error', () => {
    const r = runQuery('ВЫБРАТЬ * ИЗ Справочник.НетТакого', fx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.includes('не найдена'))).toBe(true);
    }
  });

  it('синтаксическая ошибка → parser error', () => {
    const r = runQuery('ВЫБРАТЬ ,', fx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.stage === 'parser')).toBe(true);
    }
  });

  it('виртуальные таблицы → «пока не реализованы»', () => {
    const r = runQuery('ВЫБРАТЬ * ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(&Дата)', fx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => /виртуальн|не реализ/i.test(e.message))).toBe(true);
    }
  });
});
