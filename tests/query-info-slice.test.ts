/**
 * Тесты виртуальных таблиц регистра сведений (#47): СрезПоследних, СрезПервых.
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

describe('СрезПоследних', () => {
  it('на дату первого набора цен — все ранние цены', () => {
    const r = ok(`
      ВЫБРАТЬ Номенклатура, Цена
      ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних(ДАТАВРЕМЯ(2024,2,1))
      УПОРЯДОЧИТЬ ПО Номенклатура
    `);
    // 5 позиций из первой партии
    expect(r.rows.length).toBe(5);
    const n1 = r.rows.find((row) => row[0] === 'n1');
    expect(n1?.[1]).toBe(500);
  });

  it('на дату после второй партии — новые цены', () => {
    const r = ok(`
      ВЫБРАТЬ Номенклатура, Цена
      ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних(ДАТАВРЕМЯ(2024,4,1))
    `);
    expect(r.rows.length).toBe(5);
    const n1 = r.rows.find((row) => row[0] === 'n1');
    expect(n1?.[1]).toBe(520); // цена выросла с 500 до 520 с 2024-03-01
    const n5 = r.rows.find((row) => row[0] === 'n5');
    expect(n5?.[1]).toBe(2.5);
  });

  it('без даты — самые последние цены', () => {
    const r = ok(`
      ВЫБРАТЬ Номенклатура, Цена
      ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних()
    `);
    const n1 = r.rows.find((row) => row[0] === 'n1');
    expect(n1?.[1]).toBe(520);
  });
});

describe('СрезПервых', () => {
  it('находит первые записи для каждой номенклатуры', () => {
    const r = ok(`
      ВЫБРАТЬ Номенклатура, Цена
      ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПервых()
    `);
    // 5 позиций, все с начальной ценой из 2024-01-01
    const n1 = r.rows.find((row) => row[0] === 'n1');
    expect(n1?.[1]).toBe(500);
    const n5 = r.rows.find((row) => row[0] === 'n5');
    expect(n5?.[1]).toBe(2);
  });
});

describe('Регистр сведений: обычный SELECT', () => {
  it('прямая выборка всех записей', () => {
    const r = ok(`
      ВЫБРАТЬ Номенклатура, Цена, Период
      ИЗ РегистрСведений.ЦеныНоменклатуры
    `);
    expect(r.rows.length).toBe(7); // 5 начальных + 2 обновлённых
  });
});

describe('JOIN с СрезПоследних', () => {
  it('присоединяем актуальные цены к номенклатуре', () => {
    const r = ok(`
      ВЫБРАТЬ Н.Наименование, Ц.Цена
      ИЗ Справочник.Номенклатура КАК Н
          ЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.ЦеныНоменклатуры.СрезПоследних() КАК Ц
              ПО Н.Ссылка = Ц.Номенклатура
      ГДЕ Н.Наименование = "Молоток"
    `);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0][1]).toBe(520);
  });
});
