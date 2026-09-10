/** Условие в параметрах виртуальной таблицы (#59). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSchemaYaml, parseDataYaml } from '../src/query/schema-loader';
import { buildFixture } from '../src/query/fixture';
import { runQuery } from '../src/query/interpreter';

const s = parseSchemaYaml(readFileSync('examples/query-demo/mini-erp.schema.yaml', 'utf8'));
const d = parseDataYaml(readFileSync('examples/query-demo/mini-erp.data.yaml', 'utf8'));
if (!s.ok || !d.ok) throw new Error('демо-фикстура не загрузилась');
const fx = buildFixture(s.value, d.value);

function rows(q: string, parameters: { [k: string]: string } = {}) {
  const r = runQuery(q, fx, { parameters });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join(' | '));
  return r.rowset.rows;
}

describe('отбор в параметрах', () => {
  it('условие по измерению сужает выборку', () => {
    const все = rows('ВЫБРАТЬ О.Номенклатура, О.Склад ИЗ РегистрНакопления.ОстаткиТоваров.Остатки КАК О');
    const один = rows('ВЫБРАТЬ О.Номенклатура, О.Склад ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Склад = "s_main") КАК О');
    expect(один.length).toBeLessThan(все.length);
    expect(один.every((r) => r[1] === 's_main')).toBe(true);
  });

  it('даёт тот же ответ, что тот же отбор в ГДЕ', () => {
    const впараметрах = rows('ВЫБРАТЬ О.Номенклатура, О.КоличествоОстаток ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Склад = "s_main") КАК О');
    const вгде = rows('ВЫБРАТЬ О.Номенклатура, О.КоличествоОстаток ИЗ РегистрНакопления.ОстаткиТоваров.Остатки КАК О ГДЕ О.Склад = "s_main"');
    expect(впараметрах).toEqual(вгде);
  });

  it('работает со значением из параметра запроса', () => {
    const r = rows(
      'ВЫБРАТЬ О.Склад ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Склад = &Склад) КАК О',
      { Склад: 's_east' },
    );
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x[0] === 's_east')).toBe(true);
  });

  it('понимает И / ИЛИ', () => {
    const r = rows('ВЫБРАТЬ О.Номенклатура, О.Склад ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Склад = "s_main" И Номенклатура = "n1") КАК О');
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual(['n1', 's_main']);
  });

  it('условие у оборотов — четвёртым параметром', () => {
    const все = rows('ВЫБРАТЬ О.Номенклатура ИЗ РегистрНакопления.ОстаткиТоваров.Обороты КАК О');
    const один = rows('ВЫБРАТЬ О.Номенклатура ИЗ РегистрНакопления.ОстаткиТоваров.Обороты(, , , Номенклатура = "n1") КАК О');
    expect(все.length).toBeGreaterThan(один.length);
    expect(один.every((r) => r[0] === 'n1')).toBe(true);
  });

  it('отбор в параметрах сужает итог, а не только показ', () => {
    // Сумма по всем складам против суммы по одному: числа обязаны отличаться.
    const всего = rows('ВЫБРАТЬ СУММА(О.КоличествоОстаток) КАК Всего ИЗ РегистрНакопления.ОстаткиТоваров.Остатки КАК О')[0][0] as number;
    const один = rows('ВЫБРАТЬ СУММА(О.КоличествоОстаток) КАК Всего ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Склад = "s_main") КАК О')[0][0] as number;
    expect(один).toBeLessThan(всего);
  });
});

describe('разыменование в условии', () => {
  it('через точку без алиаса — источника в скобках ещё нет', () => {
    const r = rows('ВЫБРАТЬ О.Номенклатура ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Номенклатура.Родитель = "n_grp_tool") КАК О');
    expect(r.length).toBeGreaterThan(0);
    const прямо = rows('ВЫБРАТЬ О.Номенклатура ИЗ РегистрНакопления.ОстаткиТоваров.Остатки КАК О ГДЕ О.Номенклатура.Родитель = "n_grp_tool"');
    expect(r).toEqual(прямо);
  });
});

describe('подсказки', () => {
  it('условие не на своём месте — объясняем, где его место', () => {
    const r = runQuery('ВЫБРАТЬ О.Номенклатура ИЗ РегистрНакопления.ОстаткиТоваров.Обороты(, , Номенклатура = "n1") КАК О', fx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/последним параметром/i);
    expect(r.errors[0].message).toMatch(/Обороты\(Начало, Конец, Периодичность, Условие\)/);
  });
});
