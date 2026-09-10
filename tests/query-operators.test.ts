/**
 * Тесты недостающих операторов SDBL (issue #54): DISTINCT, ЕСТЬ NULL,
 * МЕЖДУ, В (…), В ИЕРАРХИИ, ПОДОБНО, ВЫБОР.
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

describe('РАЗЛИЧНЫЕ', () => {
  it('снимает дубликаты по всем колонкам', () => {
    const r = ok('ВЫБРАТЬ РАЗЛИЧНЫЕ Склад ИЗ РегистрНакопления.ОстаткиТоваров');
    expect(r.rows.length).toBe(2);
    const s = new Set(r.rows.map((row) => row[0]));
    expect(s).toEqual(new Set(['s_main', 's_east']));
  });

  it('дубликаты по всем колонкам, не по первой', () => {
    const r = ok(`
      ВЫБРАТЬ РАЗЛИЧНЫЕ Склад, ВидДвижения
      ИЗ РегистрНакопления.ОстаткиТоваров
    `);
    // s_main × Приход/Расход, s_east × Приход/Расход
    expect(r.rows.length).toBe(4);
  });
});

describe('ПЕРВЫЕ N', () => {
  it('после УПОРЯДОЧИТЬ ПО — обрезает до N', () => {
    const r = ok(`
      ВЫБРАТЬ ПЕРВЫЕ 3 Наименование
      ИЗ Справочник.Номенклатура
      УПОРЯДОЧИТЬ ПО Наименование
    `);
    expect(r.rows.length).toBe(3);
  });
});

describe('ЕСТЬ NULL', () => {
  it('после ЛЕВОЕ СОЕДИНЕНИЕ находит непокрытые записи', () => {
    const r = ok(`
      ВЫБРАТЬ Н.Наименование
      ИЗ Справочник.Номенклатура КАК Н
          ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ОстаткиТоваров.Остатки() КАК О
              ПО Н.Ссылка = О.Номенклатура
      ГДЕ О.Номенклатура ЕСТЬ NULL
    `);
    // Группы (n_grp_tool, n_grp_met) и удалённая позиция никогда не двигались
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('ЕСТЬ НЕ NULL — обратное', () => {
    const r = ok(`
      ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К
      ИЗ Справочник.Номенклатура
      ГДЕ Родитель ЕСТЬ НЕ NULL
    `);
    // 6 позиций с родителем (все кроме двух групп)
    expect(r.rows[0][0]).toBe(6);
  });
});

describe('МЕЖДУ x И y', () => {
  it('включает границы', () => {
    const r = ok(`
      ВЫБРАТЬ Наименование
      ИЗ Справочник.Номенклатура
      ГДЕ Код МЕЖДУ "000000003" И "000000005"
    `);
    expect(r.rows.length).toBe(3);
  });
});

describe('В (…)', () => {
  it('членство в списке ссылок', () => {
    const r = ok(`
      ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К
      ИЗ Справочник.Номенклатура
      ГДЕ Ссылка В ("n1", "n2", "n3")
    `);
    expect(r.rows[0][0]).toBe(3);
  });

  it('НЕ В — исключение из списка', () => {
    const r = ok(`
      ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К
      ИЗ Справочник.Номенклатура
      ГДЕ НЕ Ссылка В ("n1", "n2")
    `);
    expect(r.rows[0][0]).toBe(6);
  });
});

describe('В ИЕРАРХИИ', () => {
  it('находит потомков поддерева', () => {
    const r = ok(`
      ВЫБРАТЬ Наименование
      ИЗ Справочник.Номенклатура
      ГДЕ Ссылка В ИЕРАРХИИ ("n_grp_tool")
    `);
    // Группа + Молоток, Отвёртка, Пила = 4
    expect(r.rows.length).toBe(4);
    const names = new Set(r.rows.map((row) => row[0]));
    expect(names.has('Молоток')).toBe(true);
    expect(names.has('Отвёртка')).toBe(true);
    expect(names.has('Пила')).toBe(true);
  });
});

describe('ПОДОБНО', () => {
  it('% как «любой хвост»', () => {
    const r = ok(`
      ВЫБРАТЬ Наименование
      ИЗ Справочник.Контрагенты
      ГДЕ Наименование ПОДОБНО "ООО%"
    `);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0][0]).toBe('ООО «Стройка»');
  });

  it('_ как «один любой»', () => {
    const r = ok(`
      ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К
      ИЗ Справочник.Номенклатура
      ГДЕ Код ПОДОБНО "00000000_"
    `);
    expect(r.rows[0][0]).toBe(8);
  });

  it('НЕ ПОДОБНО — обратное', () => {
    const r = ok(`
      ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К
      ИЗ Справочник.Контрагенты
      ГДЕ Наименование НЕ ПОДОБНО "ООО%"
    `);
    expect(r.rows[0][0]).toBe(2);
  });
});

describe('ВЫБОР КОГДА', () => {
  it('без ВЫБОР expr — условная форма', () => {
    const r = ok(`
      ВЫБРАТЬ
        Наименование,
        ВЫБОР
          КОГДА ПометкаУдаления = ИСТИНА ТОГДА "🗑"
          ИНАЧЕ "✓"
        КОНЕЦ КАК Статус
      ИЗ Справочник.Номенклатура
    `);
    const marked = r.rows.filter((row) => row[1] === '🗑');
    expect(marked.length).toBe(1);
  });

  it('с ВЫБОР expr — форма switch', () => {
    const r = ok(`
      ВЫБРАТЬ
        Наименование,
        ВЫБОР Наименование
          КОГДА "Молоток" ТОГДА 1
          КОГДА "Пила" ТОГДА 2
          ИНАЧЕ 0
        КОНЕЦ КАК Тип
      ИЗ Справочник.Номенклатура
    `);
    const molotok = r.rows.find((row) => row[0] === 'Молоток');
    const pila = r.rows.find((row) => row[0] === 'Пила');
    const otvyortka = r.rows.find((row) => row[0] === 'Отвёртка');
    expect(molotok?.[1]).toBe(1);
    expect(pila?.[1]).toBe(2);
    expect(otvyortka?.[1]).toBe(0);
  });
});
