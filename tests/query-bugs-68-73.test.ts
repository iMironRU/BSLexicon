/**
 * Регрессионные тесты по багам #68–#73 песочницы запросов.
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

describe('#72 — унарные + и − перед выражением', () => {
  it('−Поле возвращает отрицательное значение поля', () => {
    const r = ok(`
      ВЫБРАТЬ ПЕРВЫЕ 3 Д.Количество КАК Плюс, -Д.Количество КАК Минус
      ИЗ РегистрНакопления.ОстаткиТоваров КАК Д
      УПОРЯДОЧИТЬ ПО Плюс
    `);
    expect(r.rows.length).toBe(3);
    for (const [plus, minus] of r.rows) {
      expect(typeof plus).toBe('number');
      expect(typeof minus).toBe('number');
      expect(minus).toBe(-(plus as number));
    }
  });

  it('+Поле разбирается и равно полю', () => {
    const r = ok(`
      ВЫБРАТЬ ПЕРВЫЕ 3 Д.Количество КАК Обычное, +Д.Количество КАК СПлюсом
      ИЗ РегистрНакопления.ОстаткиТоваров КАК Д
    `);
    expect(r.rows.length).toBe(3);
    for (const [orig, plus] of r.rows) expect(plus).toBe(orig);
  });

  it('−Поле под агрегатом', () => {
    const rMinus = ok(`
      ВЫБРАТЬ СУММА(-Д.Количество) КАК Итог
      ИЗ РегистрНакопления.ОстаткиТоваров КАК Д
      ГДЕ Д.ВидДвижения = "Расход"
    `);
    const rPlus = ok(`
      ВЫБРАТЬ СУММА(Д.Количество) КАК Итог
      ИЗ РегистрНакопления.ОстаткиТоваров КАК Д
      ГДЕ Д.ВидДвижения = "Расход"
    `);
    expect(rMinus.rows[0][0]).toBe(-(rPlus.rows[0][0] as number));
  });

  it('−Поле в выражении ВЫБОР под СУММА даёт тот же остаток, что виртуальная таблица', () => {
    // Сумма прихода минус расход через ВЫБОР по движениям
    const rMovements = ok(`
      ВЫБРАТЬ Д.Номенклатура КАК Ном,
              СУММА(ВЫБОР КОГДА Д.ВидДвижения = "Приход"
                          ТОГДА Д.Количество ИНАЧЕ -Д.Количество КОНЕЦ) КАК Остаток
      ИЗ РегистрНакопления.ОстаткиТоваров КАК Д
      СГРУППИРОВАТЬ ПО Д.Номенклатура
    `);
    // То же через виртуальную таблицу .Остатки()
    const rVt = ok(`
      ВЫБРАТЬ О.Номенклатура КАК Ном, О.КоличествоОстаток КАК Остаток
      ИЗ РегистрНакопления.ОстаткиТоваров.Остатки() КАК О
    `);

    const byNomMovements = new Map<unknown, unknown>(rMovements.rows.map((row) => [row[0], row[1]]));
    const byNomVt = new Map<unknown, unknown>();
    for (const [nom, ost] of rVt.rows) {
      byNomVt.set(nom, ((byNomVt.get(nom) as number | undefined) ?? 0) + (ost as number));
    }
    expect(byNomVt.size).toBeGreaterThan(0);
    for (const [nom, expected] of byNomVt) {
      expect(byNomMovements.get(nom)).toBe(expected);
    }
  });
});
