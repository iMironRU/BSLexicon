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
