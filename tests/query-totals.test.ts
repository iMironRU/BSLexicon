/**
 * Тесты ИТОГИ ПО (#45).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixture, type Fixture } from '../src/query/fixture';
import { runQuery } from '../src/query/interpreter';
import { parseDataYaml, parseSchemaYaml } from '../src/query/schema-loader';
import { NULL } from '../src/core/interpreter/values';

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

describe('ИТОГИ ПО одному полю', () => {
  it('добавляет строку-итог для каждого значения группы', () => {
    const r = ok(`
      ВЫБРАТЬ
        Склад,
        Номенклатура,
        СУММА(Количество) КАК Кол
      ИЗ РегистрНакопления.ОстаткиТоваров
      СГРУППИРОВАТЬ ПО Склад, Номенклатура
      ИТОГИ ПО Склад
    `);
    // Детальных строк: 6 (5 на s_main + 1 на s_east); итоговых: 2 (по одному на склад)
    // Всего: 8
    expect(r.rows.length).toBe(8);
    // rowLevels: 6 нулей + 2 единицы
    const detailCount = r.rowLevels!.filter((l) => l === 0).length;
    const totalCount = r.rowLevels!.filter((l) => l === 1).length;
    expect(detailCount).toBe(6);
    expect(totalCount).toBe(2);
  });

  it('в итоговой строке — значение группы, остальные NULL, агрегат пересчитан', () => {
    const r = ok(`
      ВЫБРАТЬ
        Склад,
        Номенклатура,
        СУММА(КоличествоОстаток) КАК Кол
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки()
      СГРУППИРОВАТЬ ПО Склад, Номенклатура
      ИТОГИ ПО Склад
    `);
    const eastTotal = r.rows.find((row, i) => r.rowLevels?.[i] === 1 && row[0] === 's_east');
    expect(eastTotal).toBeDefined();
    expect(eastTotal![2]).toBe(40); // n1 на s_east: 50 приход - 10 расход = 40
    expect(eastTotal![1]).toBe(NULL);
  });
});

describe('ИТОГИ ПО двум полям — вложенные уровни', () => {
  it('генерирует два уровня итогов', () => {
    const r = ok(`
      ВЫБРАТЬ
        Склад,
        Номенклатура,
        СУММА(Количество) КАК Кол
      ИЗ РегистрНакопления.ОстаткиТоваров
      СГРУППИРОВАТЬ ПО Склад, Номенклатура
      ИТОГИ ПО Склад, Номенклатура
    `);
    // По каждому Складу — 1 итог, по каждой паре (Склад, Ном) — 1 итог тоже (совпадает с деталями по числу)
    const level1 = r.rowLevels!.filter((l) => l === 1).length;
    const level2 = r.rowLevels!.filter((l) => l === 2).length;
    expect(level1).toBe(2); // s_main + s_east
    expect(level2).toBe(6); // столько же, сколько деталей
  });
});

describe('порядок и содержимое строк-итогов', () => {
  it('итог стоит над своими подробностями', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Номенклатура, Т.Количество
      ИЗ Документ.РасходнаяНакладная.Товары КАК Т
      ИТОГИ СУММА(Количество) ПО Т.Номенклатура
    `);
    const ном = r.columns.indexOf('Номенклатура');
    const кол = r.columns.indexOf('Количество');
    expect(r.rowLevels![0]).toBe(1); // первая строка — итог, а не подробность

    for (let i = 0; i < r.rows.length; i += 1) {
      if (r.rowLevels![i] !== 1) continue;
      let сумма = 0;
      let j = i + 1;
      for (; j < r.rows.length && r.rowLevels![j] === 0; j += 1) {
        expect(r.rows[j][ном]).toEqual(r.rows[i][ном]); // подробности того же товара
        сумма += r.rows[j][кол] as number;
      }
      expect(j).toBeGreaterThan(i + 1);
      expect(r.rows[i][кол]).toBe(сумма);
      expect(r.rows[i][ном]).not.toBe(NULL); // видно, чей это итог
    }
  });

  it('ОБЩИЕ даёт строку общего итога, и она первая', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Количество
      ИЗ Документ.РасходнаяНакладная.Товары КАК Т
      ИТОГИ СУММА(Количество) ПО ОБЩИЕ
    `);
    expect(r.rowLevels![0]).toBe(1);
    const детали = r.rows.filter((_, i) => r.rowLevels![i] === 0);
    expect(r.rows[0][0]).toBe(детали.reduce((a, row) => a + (row[0] as number), 0));
    expect(r.rows).toHaveLength(детали.length + 1);
  });

  it('ОБЩИЕ вместе с контрольной точкой: общий первым, дальше группы', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Номенклатура, Т.Количество
      ИЗ Документ.РасходнаяНакладная.Товары КАК Т
      ИТОГИ СУММА(Количество) ПО ОБЩИЕ, Т.Номенклатура
    `);
    expect(r.rowLevels![0]).toBe(1);
    expect(r.rowLevels![1]).toBe(2);
    const кол = r.columns.indexOf('Количество');
    const группы = r.rows.filter((_, i) => r.rowLevels![i] === 2);
    expect(r.rows[0][кол]).toBe(группы.reduce((a, row) => a + (row[кол] as number), 0));
  });

  it('без списка функций берёт агрегаты выборки', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Ссылка.Склад КАК Склад, Т.Номенклатура, СУММА(Т.Количество) КАК Продано
      ИЗ Документ.РасходнаяНакладная.Товары КАК Т
      СГРУППИРОВАТЬ ПО Т.Ссылка.Склад, Т.Номенклатура
      ИТОГИ ПО Склад
    `);
    const продано = r.columns.indexOf('Продано');
    for (let i = 0; i < r.rows.length; i += 1) {
      if (r.rowLevels![i] !== 1) continue;
      let сумма = 0;
      for (let j = i + 1; j < r.rows.length && r.rowLevels![j] === 0; j += 1) сумма += r.rows[j][продано] as number;
      expect(r.rows[i][продано]).toBe(сумма);
    }
  });

  it('КОЛИЧЕСТВО над сгруппированным складывается, а не считает группы', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Номенклатура, КОЛИЧЕСТВО(Т.Сумма) КАК Строк
      ИЗ Документ.РасходнаяНакладная.Товары КАК Т
      СГРУППИРОВАТЬ ПО Т.Номенклатура
      ИТОГИ КОЛИЧЕСТВО(Строк) ПО ОБЩИЕ
    `);
    const строк = r.columns.indexOf('Строк');
    const детали = r.rows.filter((_, i) => r.rowLevels![i] === 0);
    expect(r.rows[0][строк]).toBe(детали.reduce((a, row) => a + (row[строк] as number), 0));
  });
});

describe('ИТОГИ: понятные отказы', () => {
  const fail = (q: string) => {
    const r = runQuery(q, fx);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.errors[0].message;
  };

  it('контрольная точка не из выборки', () => {
    expect(fail('ВЫБРАТЬ Т.Номенклатура ИЗ Документ.РасходнаяНакладная.Товары КАК Т ИТОГИ СУММА(Количество) ПО Т.Цена'))
      .toMatch(/Контрольная точка «Цена» не найдена/i);
  });

  it('иерархия пока не поддержана', () => {
    expect(fail('ВЫБРАТЬ Т.Номенклатура ИЗ Документ.РасходнаяНакладная.Товары КАК Т ИТОГИ ПО Т.Номенклатура ИЕРАРХИЯ'))
      .toMatch(/ИЕРАРХИЯ/);
  });

  it('в ИТОГИ не агрегатная функция', () => {
    expect(fail('ВЫБРАТЬ Т.Номенклатура, Т.Количество ИЗ Документ.РасходнаяНакладная.Товары КАК Т ИТОГИ Т.Количество ПО ОБЩИЕ'))
      .toMatch(/агрегатная функция/i);
  });
});
