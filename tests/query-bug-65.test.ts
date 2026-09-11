/**
 * Регрессионный тест #65: В ИЕРАРХИИ должен работать в условии виртуальной
 * таблицы и вообще в GDE.
 */
import { describe, expect, it } from 'vitest';
import { runQuery } from '../src/query/interpreter';
import { loadMiniErpFixture, runOk } from './fixtures/mini-erp';

const fx = loadMiniErpFixture();
const ok = (source: string) => runOk(source, fx);

describe('#65 dot-notation вне алиаса', () => {
  it('Родитель.Наименование без явного alias — работает', () => {
    const r = ok(`
      ВЫБРАТЬ Наименование, Родитель.Наименование КАК Группа
      ИЗ Справочник.Номенклатура
      ГДЕ Наименование = "Молоток"
    `);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0][1]).toBe('Инструмент');
  });
});

describe('#65 В ИЕРАРХИИ у неиерархического справочника', () => {
  it('чёткая ошибка, а не молчание', () => {
    const r = runQuery(`
      ВЫБРАТЬ Наименование ИЗ Справочник.Контрагенты ГДЕ Ссылка В ИЕРАРХИИ ("k1")
    `, fx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => /иерархическ|Контрагенты/i.test(e.message))).toBe(true);
    }
  });
});

describe('#65 В ИЕРАРХИИ с параметром', () => {
  it('&Группа корректно резолвится', () => {
    const r = runQuery(`
      ВЫБРАТЬ Наименование
      ИЗ Справочник.Номенклатура
      ГДЕ Ссылка В ИЕРАРХИИ (&Группа)
    `, fx, { parameters: { Группа: 'n_grp_tool' } });
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
    // Группа + 3 инструмента (Молоток, Отвёртка, Пила) = 4
    expect(r.rowset.rows.length).toBe(4);
  });
});

describe('#65 В ИЕРАРХИИ в условии VT', () => {
  it('Остатки(, Номенклатура В ИЕРАРХИИ (…)) — не пусто', () => {
    const r = ok(`
      ВЫБРАТЬ Номенклатура
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Номенклатура В ИЕРАРХИИ ("n_grp_tool"))
    `);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('тот же результат, что фильтр через Родитель', () => {
    const rHier = ok(`
      ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Номенклатура В ИЕРАРХИИ ("n_grp_tool"))
    `);
    const rParent = ok(`
      ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки(, Номенклатура.Родитель = "n_grp_tool")
    `);
    expect(rHier.rows[0][0]).toBe(rParent.rows[0][0]);
  });
});
