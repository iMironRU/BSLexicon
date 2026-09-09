/**
 * Регрессионные тесты по багам #49–#52 песочницы запросов.
 * Изначально красные — фиксируем поведение, потом чиним.
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

describe('#52 — унарное НЕ над полем-булевом', () => {
  it('ГДЕ НЕ Т.ПометкаУдаления', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Наименование
      ИЗ Справочник.Номенклатура КАК Т
      ГДЕ НЕ Т.ПометкаУдаления
    `);
    // 7 непомеченных, 1 помеченная — «Устаревшая позиция»
    expect(r.rows.length).toBe(7);
  });

  it('НЕ и обычное сравнение эквивалентны', () => {
    const notForm = ok('ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К ИЗ Справочник.Номенклатура КАК Т ГДЕ НЕ Т.ПометкаУдаления').rows[0][0];
    const eqForm  = ok('ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К ИЗ Справочник.Номенклатура КАК Т ГДЕ Т.ПометкаУдаления = ЛОЖЬ').rows[0][0];
    expect(notForm).toBe(eqForm);
  });

  it('НЕ над скобочным выражением', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Наименование
      ИЗ Справочник.Номенклатура КАК Т
      ГДЕ НЕ (Т.ПометкаУдаления = ИСТИНА)
    `);
    expect(r.rows.length).toBe(7);
  });
});

describe('#51 — оборотный регистр: только .Обороты', () => {
  // Мини-схема с view: 'Обороты'
  const turnoverSchemaYaml = `
version: 1
tables:
  - kind: РегистрНакопления
    name: Продажи
    view: Обороты
    dimensions:
      - { name: Товар, type: Строка(50) }
    resources:
      - { name: Сумма, type: "Число(15,2)" }
`;
  const turnoverDataYaml = `
version: 1
records:
  РегистрНакопления.Продажи:
    - { Период: "2026-03-05T00:00:00", Регистратор: "d1", Товар: "Стул", Сумма: 100 }
    - { Период: "2026-03-10T00:00:00", Регистратор: "d2", Товар: "Стул", Сумма: 250 }
    - { Период: "2026-03-15T00:00:00", Регистратор: "d3", Товар: "Стол", Сумма: 400 }
`;

  let turnFx: Fixture;
  beforeAll(() => {
    const s = parseSchemaYaml(turnoverSchemaYaml);
    const d = parseDataYaml(turnoverDataYaml);
    if (!s.ok || !d.ok) throw new Error('turn fixtures broken');
    turnFx = buildFixture(s.value, d.value);
  });

  it('.Обороты по оборотному регистру — работает', () => {
    const r = runQuery(`
      ВЫБРАТЬ Товар, СуммаОборот
      ИЗ РегистрНакопления.Продажи.Обороты(ДАТАВРЕМЯ(2026,3,1), ДАТАВРЕМЯ(2026,4,1))
      УПОРЯДОЧИТЬ ПО Товар
    `, turnFx);
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
    expect(r.rowset.rows.length).toBe(2);
    const stol = r.rowset.rows.find((row) => row[0] === 'Стол');
    const stul = r.rowset.rows.find((row) => row[0] === 'Стул');
    expect(stol?.[1]).toBe(400);
    expect(stul?.[1]).toBe(350);
  });

  it('.Остатки по оборотному регистру — отклоняется', () => {
    const r = runQuery(`ВЫБРАТЬ * ИЗ РегистрНакопления.Продажи.Остатки()`, turnFx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /Остатки|остатков/i.test(e.message))).toBe(true);
  });

  it('.ОстаткиИОбороты по оборотному регистру — отклоняется', () => {
    const r = runQuery(`ВЫБРАТЬ * ИЗ РегистрНакопления.Продажи.ОстаткиИОбороты()`, turnFx);
    expect(r.ok).toBe(false);
  });
});

describe('#50 — виртуальная таблица в правой части соединения', () => {
  it('ЛЕВОЕ СОЕДИНЕНИЕ Справочник.Номенклатура ↔ Остатки() — со скобками', () => {
    const r = ok(`
      ВЫБРАТЬ Н.Наименование, О.КоличествоОстаток
      ИЗ Справочник.Номенклатура КАК Н
          ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ОстаткиТоваров.Остатки() КАК О
              ПО Н.Ссылка = О.Номенклатура
    `);
    // Все 8 позиций номенклатуры (в том числе группы, у которых остатков нет)
    expect(r.rows.length).toBeGreaterThanOrEqual(8);
    // Молоток должен иметь ненулевой остаток
    const molotki = r.rows.filter((row) => row[0] === 'Молоток' && typeof row[1] === 'number');
    expect(molotki.length).toBeGreaterThan(0);
  });

  it('.Остатки без скобок в правой части — тот же результат', () => {
    // Точная форма из бага #50: без ()
    const r = ok(`
      ВЫБРАТЬ Н.Наименование, О.КоличествоОстаток
      ИЗ Справочник.Номенклатура КАК Н
          ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ОстаткиТоваров.Остатки КАК О
              ПО Н.Ссылка = О.Номенклатура
    `);
    expect(r.columns).toEqual(['Наименование', 'КоличествоОстаток']);
    expect(r.rows.length).toBeGreaterThanOrEqual(8);
  });
});

describe('#49 — табличная часть документа как источник', () => {
  it('ИЗ Документ.РасходнаяНакладная.Товары — 6 строк табличных частей', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Номенклатура, Т.Количество
      ИЗ Документ.РасходнаяНакладная.Товары КАК Т
    `);
    // d1 = 3 строки + d2 = 2 + d3 = 1 + d4 = 1 = 7 строк
    expect(r.rows.length).toBe(7);
    // Значения не должны быть undefined/NULL
    expect(r.rows.every((row) => typeof row[1] === 'number')).toBe(true);
  });

  it('Т.Ссылка возвращает ссылку на документ-владелец', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Ссылка
      ИЗ Документ.РасходнаяНакладная.Товары КАК Т
      УПОРЯДОЧИТЬ ПО Ссылка
    `);
    expect(r.rows.length).toBe(7);
    // Все ссылки — из списка d1..d4
    const uniq = new Set(r.rows.map((row) => row[0]));
    for (const ref of uniq) expect(['d1', 'd2', 'd3', 'd4']).toContain(ref);
  });

  it('Т.Ссылка.Дата разыменовывает шапку документа', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Ссылка.Дата
      ИЗ Документ.РасходнаяНакладная.Товары КАК Т
    `);
    expect(r.rows.length).toBe(7);
    // Все даты — строки, не NULL/undefined
    expect(r.rows.every((row) => typeof row[0] === 'string' && row[0].length > 0)).toBe(true);
    const uniqDates = new Set(r.rows.map((row) => row[0]));
    expect(uniqDates.size).toBe(4); // всего 4 разных дня у d1..d4
  });
});
