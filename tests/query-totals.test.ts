/** ИТОГИ ... ПО (#45). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSchemaYaml, parseDataYaml } from '../src/query/schema-loader';
import { buildFixture } from '../src/query/fixture';
import { runQuery } from '../src/query/interpreter';

const s = parseSchemaYaml(readFileSync('examples/query-demo/mini-erp.schema.yaml', 'utf8'));
const d = parseDataYaml(readFileSync('examples/query-demo/mini-erp.data.yaml', 'utf8'));
if (!s.ok || !d.ok) throw new Error('демо-фикстура не загрузилась');
const fx = buildFixture(s.value, d.value);

function go(q: string) {
  const r = runQuery(q, fx);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join(' | '));
  return r;
}

describe('общие итоги', () => {
  it('строка общего итога идёт первой и суммирует всё', () => {
    const r = go(`ВЫБРАТЬ Т.Номенклатура, Т.Количество
                  ИЗ Документ.РасходнаяНакладная.Товары КАК Т
                  ИТОГИ СУММА(Количество) ПО ОБЩИЕ`);
    const { rows, totalLevels, columns } = r.rowset;
    const kol = columns.indexOf('Количество');
    expect(totalLevels?.[0]).toBe(0);
    const подробности = rows.filter((_, i) => totalLevels?.[i] === null);
    const сумма = подробности.reduce((a, row) => a + (row[kol] as number), 0);
    expect(rows[0][kol]).toBe(сумма);
    expect(rows).toHaveLength(подробности.length + 1);
  });
});

describe('итоги по контрольной точке', () => {
  it('итог группы стоит перед её подробностями', () => {
    const r = go(`ВЫБРАТЬ Т.Номенклатура, Т.Количество
                  ИЗ Документ.РасходнаяНакладная.Товары КАК Т
                  ИТОГИ СУММА(Количество) ПО Т.Номенклатура`);
    const { rows, totalLevels, columns } = r.rowset;
    const ном = columns.indexOf('Номенклатура');
    const kol = columns.indexOf('Количество');

    expect(totalLevels?.[0]).toBe(1); // первая строка — итог первой группы
    // за каждым итогом идут строки с тем же значением контрольной точки
    for (let i = 0; i < rows.length; i += 1) {
      if (totalLevels?.[i] !== 1) continue;
      let sum = 0;
      let j = i + 1;
      for (; j < rows.length && totalLevels?.[j] === null; j += 1) {
        expect(rows[j][ном]).toEqual(rows[i][ном]);
        sum += rows[j][kol] as number;
      }
      expect(j).toBeGreaterThan(i + 1); // группа не пуста
      expect(rows[i][kol]).toBe(sum);
    }
  });

  it('общий итог и точка вместе: сначала общий, потом группы', () => {
    const r = go(`ВЫБРАТЬ Т.Номенклатура, Т.Количество
                  ИЗ Документ.РасходнаяНакладная.Товары КАК Т
                  ИТОГИ СУММА(Количество) ПО ОБЩИЕ, Т.Номенклатура`);
    const levels = r.rowset.totalLevels!;
    expect(levels[0]).toBe(0);
    expect(levels[1]).toBe(1);
    const общий = r.rowset.rows[0][r.rowset.columns.indexOf('Количество')] as number;
    const группы = r.rowset.rows.filter((_, i) => levels[i] === 1);
    const сумма = группы.reduce((a, row) => a + (row[r.rowset.columns.indexOf('Количество')] as number), 0);
    expect(общий).toBe(сумма);
  });

  it('две контрольные точки дают два уровня', () => {
    const r = go(`ВЫБРАТЬ Т.Ссылка.Склад КАК Склад, Т.Номенклатура, Т.Сумма
                  ИЗ Документ.РасходнаяНакладная.Товары КАК Т
                  ИТОГИ СУММА(Сумма) ПО Склад, Т.Номенклатура`);
    const levels = new Set(r.rowset.totalLevels!.filter((l) => l !== null));
    expect(levels).toEqual(new Set([1, 2]));
  });
});

describe('итоги поверх группировки', () => {
  it('без списка функций берёт агрегаты из выборки и складывает их', () => {
    const r = go(`ВЫБРАТЬ Т.Ссылка.Склад КАК Склад, Т.Номенклатура, СУММА(Т.Количество) КАК Продано
                  ИЗ Документ.РасходнаяНакладная.Товары КАК Т
                  СГРУППИРОВАТЬ ПО Т.Ссылка.Склад, Т.Номенклатура
                  ИТОГИ ПО Склад`);
    const { rows, totalLevels, columns } = r.rowset;
    const продано = columns.indexOf('Продано');
    for (let i = 0; i < rows.length; i += 1) {
      if (totalLevels?.[i] !== 1) continue;
      let sum = 0;
      for (let j = i + 1; j < rows.length && totalLevels?.[j] === null; j += 1) sum += rows[j][продано] as number;
      expect(rows[i][продано]).toBe(sum);
    }
  });

  it('КОЛИЧЕСТВО над сгруппированным складывается, а не считает строки', () => {
    const r = go(`ВЫБРАТЬ Т.Номенклатура, КОЛИЧЕСТВО(Т.Сумма) КАК Строк
                  ИЗ Документ.РасходнаяНакладная.Товары КАК Т
                  СГРУППИРОВАТЬ ПО Т.Номенклатура
                  ИТОГИ КОЛИЧЕСТВО(Строк) ПО ОБЩИЕ`);
    const { rows, totalLevels, columns } = r.rowset;
    const строк = columns.indexOf('Строк');
    const детали = rows.filter((_, i) => totalLevels?.[i] === null);
    expect(rows[0][строк]).toBe(детали.reduce((a, r2) => a + (r2[строк] as number), 0));
  });
});

describe('понятные отказы', () => {
  it('контрольная точка не из выборки', () => {
    const r = runQuery(`ВЫБРАТЬ Т.Номенклатура ИЗ Документ.РасходнаяНакладная.Товары КАК Т ИТОГИ СУММА(Количество) ПО Т.Цена`, fx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/Контрольная точка «Цена» не найдена/i);
  });

  it('иерархия пока не поддержана — говорим прямо', () => {
    const r = runQuery(`ВЫБРАТЬ Т.Номенклатура ИЗ Документ.РасходнаяНакладная.Товары КАК Т ИТОГИ ПО Т.Номенклатура ИЕРАРХИЯ`, fx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/ИЕРАРХИЯ/);
  });

  it('в ИТОГИ не агрегат — объясняем', () => {
    const r = runQuery(`ВЫБРАТЬ Т.Номенклатура, Т.Количество ИЗ Документ.РасходнаяНакладная.Товары КАК Т ИТОГИ Т.Количество ПО ОБЩИЕ`, fx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/не агрегатная функция|агрегатная функция/i);
  });
});
