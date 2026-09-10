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

describe('ЕСТЬNULL(x, y) — COALESCE', () => {
  it('подменяет NULL на второй аргумент', () => {
    const r = ok(`
      ВЫБРАТЬ ЕСТЬNULL(Родитель, "нет-родителя") КАК Р
      ИЗ Справочник.Номенклатура
      ГДЕ Ссылка = "n_grp_tool"
    `);
    expect(r.rows[0][0]).toBe('нет-родителя');
  });

  it('оставляет значение, если оно не NULL', () => {
    const r = ok(`
      ВЫБРАТЬ ЕСТЬNULL(Наименование, "?") КАК Н
      ИЗ Справочник.Номенклатура
      ГДЕ Ссылка = "n1"
    `);
    expect(r.rows[0][0]).toBe('Молоток');
  });
});

describe('Автополя', () => {
  const bareSchemaYaml = `
version: 1
tables:
  - kind: Справочник
    name: Товары
    hierarchical: true
    fields:
      - { name: Цвет, type: Строка(20) }
`;
  const bareDataYaml = `
version: 1
records:
  Справочник.Товары:
    - { Ссылка: t1, Код: "000000001", Наименование: Стул, ПометкаУдаления: false, Цвет: Синий, Родитель: null }
    - { Ссылка: t2, Код: "000000002", Наименование: Стол, ПометкаУдаления: false, Цвет: Красный, Родитель: null }
    - { Ссылка: t3, Код: "000000003", Наименование: Тумбочка, ПометкаУдаления: true, Цвет: Зелёный, Родитель: null }
`;

  it('справочник без объявленных Ссылка/ПометкаУдаления — доступны как автополя', () => {
    const s = parseSchemaYaml(bareSchemaYaml);
    if (!s.ok) throw new Error(`schema: ${s.error}`);
    const d = parseDataYaml(bareDataYaml);
    if (!d.ok) throw new Error(`data: ${d.error}`);
    const bareFx = buildFixture(s.value, d.value);
    const r = runQuery(
      'ВЫБРАТЬ Наименование ИЗ Справочник.Товары ГДЕ НЕ ПометкаУдаления',
      bareFx,
    );
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
    expect(r.rowset.rows.length).toBe(2);
  });

  it('иерархический справочник знает Родитель, даже если не объявлен', () => {
    const s = parseSchemaYaml(bareSchemaYaml);
    if (!s.ok) throw new Error(`schema: ${s.error}`);
    const d = parseDataYaml(bareDataYaml);
    if (!d.ok) throw new Error(`data: ${d.error}`);
    const bareFx = buildFixture(s.value, d.value);
    const r = runQuery(
      'ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ Справочник.Товары ГДЕ Родитель ЕСТЬ NULL',
      bareFx,
    );
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
    expect(r.rowset.rows[0][0]).toBe(3);
  });
});

describe('ОБЪЕДИНИТЬ', () => {
  it('ОБЪЕДИНИТЬ ВСЕ сохраняет дубли', () => {
    const r = ok(`
      ВЫБРАТЬ Наименование ИЗ Справочник.Номенклатура ГДЕ Ссылка = "n1"
      ОБЪЕДИНИТЬ ВСЕ
      ВЫБРАТЬ Наименование ИЗ Справочник.Номенклатура ГДЕ Ссылка = "n1"
    `);
    expect(r.rows.length).toBe(2);
    expect(r.rows[0][0]).toBe('Молоток');
  });

  it('ОБЪЕДИНИТЬ (без ВСЕ) убирает дубли', () => {
    const r = ok(`
      ВЫБРАТЬ Наименование ИЗ Справочник.Номенклатура ГДЕ Ссылка = "n1"
      ОБЪЕДИНИТЬ
      ВЫБРАТЬ Наименование ИЗ Справочник.Номенклатура ГДЕ Ссылка = "n1"
    `);
    expect(r.rows.length).toBe(1);
  });

  it('склеивает справочник со складом', () => {
    const r = ok(`
      ВЫБРАТЬ Наименование КАК Имя ИЗ Справочник.Номенклатура ГДЕ Код = "000000003"
      ОБЪЕДИНИТЬ ВСЕ
      ВЫБРАТЬ Наименование ИЗ Справочник.Склады
    `);
    expect(r.rows.length).toBe(3); // 1 + 2 складов
    expect(r.columns).toEqual(['Имя']);
  });

  it('несовпадение числа колонок → ошибка', () => {
    const r = runQuery(`
      ВЫБРАТЬ Наименование ИЗ Справочник.Номенклатура
      ОБЪЕДИНИТЬ
      ВЫБРАТЬ Код, Наименование ИЗ Справочник.Склады
    `, fx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /ОБЪЕДИНИТЬ/i.test(e.message))).toBe(true);
  });
});

describe('Подзапросы', () => {
  it('подзапрос в ИЗ — материализуется как источник', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Наименование
      ИЗ (
        ВЫБРАТЬ Наименование
        ИЗ Справочник.Номенклатура
        ГДЕ ПометкаУдаления = ЛОЖЬ
      ) КАК Т
    `);
    expect(r.rows.length).toBe(7);
  });

  it('подзапрос с агрегатом в ИЗ', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Всего
      ИЗ (
        ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК Всего
        ИЗ Справочник.Номенклатура
      ) КАК Т
    `);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0][0]).toBe(8);
  });

  it('подзапрос в В (…) — фильтрация по результату', () => {
    const r = ok(`
      ВЫБРАТЬ Наименование
      ИЗ Справочник.Номенклатура
      ГДЕ Ссылка В (
        ВЫБРАТЬ РАЗЛИЧНЫЕ Номенклатура
        ИЗ РегистрНакопления.ОстаткиТоваров
      )
    `);
    // Позиции, у которых были движения — n1..n5
    expect(r.rows.length).toBe(5);
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
