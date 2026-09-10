/**
 * Регрессионный тест #59: условие в параметрах виртуальной таблицы
 * теперь применяется к сырым строкам регистра ДО агрегации.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixture, type Fixture } from '../src/query/fixture';
import { runQuery } from '../src/query/interpreter';
import { parseDataYaml, parseSchemaYaml } from '../src/query/schema-loader';

let fx: Fixture;

beforeAll(() => {
  const s = parseSchemaYaml(readFileSync(join(__dirname, '../examples/query-demo/mini-erp.schema.yaml'), 'utf8'));
  const d = parseDataYaml(readFileSync(join(__dirname, '../examples/query-demo/mini-erp.data.yaml'), 'utf8'));
  if (!s.ok || !d.ok) throw new Error('demo fixtures broken');
  fx = buildFixture(s.value, d.value);
});

function ok(source: string) {
  const r = runQuery(source, fx);
  if (!r.ok) throw new Error(`Ошибки:\n${r.errors.map((e) => `[${e.stage}] ${e.message}`).join('\n')}\nЗапрос:\n${source}`);
  return r.rowset;
}

describe('#59 условие в параметрах Остатки', () => {
  it('с литералом: считает только по одному складу', () => {
    const r = ok(`
      ВЫБРАТЬ Номенклатура, КоличествоОстаток
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Склад = "s_east")
    `);
    // Только n1 на s_east: 50-10 = 40
    expect(r.rows.length).toBe(1);
    expect(r.rows[0][1]).toBe(40);
  });

  it('с параметром &Склад — тот же результат', () => {
    const r = runQuery(`
      ВЫБРАТЬ Номенклатура, КоличествоОстаток
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Склад = &Склад)
    `, fx, { parameters: { Склад: 's_east' } });
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
    expect(r.rowset.rows.length).toBe(1);
    expect(r.rowset.rows[0][1]).toBe(40);
  });

  it('условие с И — комбинирует два поля', () => {
    const r = ok(`
      ВЫБРАТЬ КоличествоОстаток
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Склад = "s_main" И Номенклатура = "n1")
    `);
    // Только n1 на s_main: 100-5=95
    expect(r.rows.length).toBe(1);
    expect(r.rows[0][0]).toBe(95);
  });

  it('тот же ответ, что фильтр в ГДЕ', () => {
    const inParam = ok(`
      ВЫБРАТЬ СУММА(КоличествоОстаток) КАК Итог
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Склад = "s_main")
    `);
    const inWhere = ok(`
      ВЫБРАТЬ СУММА(КоличествоОстаток) КАК Итог
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки() КАК О
      ГДЕ О.Склад = "s_main"
    `);
    expect(inParam.rows[0][0]).toBe(inWhere.rows[0][0]);
  });
});

describe('#59 условие в параметрах Обороты', () => {
  it('4-й параметр — условие (3-й — периодичность, пропущен)', () => {
    const r = ok(`
      ВЫБРАТЬ Номенклатура, КоличествоОборот
      ИЗ РегистрНакопления.ОстаткиТоваров.Обороты(
          ДАТАВРЕМЯ(2024, 1, 1),
          ДАТАВРЕМЯ(2024, 4, 1),
          ,
          Склад = "s_east"
      )
    `);
    expect(r.rows.length).toBe(1);
    // n1 на s_east в январе-марте: приход 50 в начале, расход 10 в марте — Оборот 40
    expect(r.rows[0][1]).toBe(40);
  });
});

describe('#59 условие в параметрах СрезПоследних', () => {
  it('фильтрация цен по номенклатуре', () => {
    const r = ok(`
      ВЫБРАТЬ Номенклатура, Цена
      ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних(, Номенклатура = "n1")
    `);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0][1]).toBe(520);
  });
});

describe('#59 условие по несуществующему полю → warning', () => {
  it('выдаёт предупреждение вместо молчания', () => {
    const r = runQuery(`
      ВЫБРАТЬ Номенклатура ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, НетТакого = "x")
    `, fx);
    if (!r.ok) throw new Error('unexpected');
    expect(r.warnings.some((w) => /НетТакого|не найдено/i.test(w))).toBe(true);
  });
});
