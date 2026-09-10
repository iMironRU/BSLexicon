/**
 * Регрессионные тесты по багам #68–#73 песочницы запросов.
 * Изначально красные — фиксируем поведение, потом чиним.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NULL } from '@core/interpreter/values';
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

describe('#68 — ПЕРВЫЕ и УПОРЯДОЧИТЬ ПО внутри подзапроса', () => {
  it('ПЕРВЫЕ 3 в подзапросе ограничивает выборку до трёх строк', () => {
    // Сначала контроль: всего строк табличных частей — 7 (d1:3 + d2:2 + d3:1 + d4:1)
    const rAll = ok(`
      ВЫБРАТЬ Т.Количество ИЗ Документ.РасходнаяНакладная.Товары КАК Т
    `);
    expect(rAll.rows.length).toBe(7);

    const r = ok(`
      ВЫБРАТЬ Верх.Количество
      ИЗ (ВЫБРАТЬ ПЕРВЫЕ 3
              С.Количество КАК Количество
          ИЗ Документ.РасходнаяНакладная.Товары КАК С
          УПОРЯДОЧИТЬ ПО С.Количество УБЫВ) КАК Верх
    `);
    expect(r.rows.length).toBe(3);
    const vals = r.rows.map((row) => row[0] as number);
    // Проверим что это действительно топ-3 по убыванию
    const sorted = (rAll.rows.map((row) => row[0] as number)).sort((a, b) => b - a).slice(0, 3);
    expect(vals).toEqual(sorted);
  });

  it('УПОРЯДОЧИТЬ ПО внутри подзапроса сортирует его результат', () => {
    // Без ПЕРВЫЕ — порядок «попал» из подзапроса наверх
    const r = ok(`
      ВЫБРАТЬ Верх.Количество
      ИЗ (ВЫБРАТЬ С.Количество КАК Количество
          ИЗ Документ.РасходнаяНакладная.Товары КАК С
          УПОРЯДОЧИТЬ ПО С.Количество) КАК Верх
    `);
    const vals = r.rows.map((row) => row[0] as number);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
  });

  it('ПЕРВЫЕ N без УПОРЯДОЧИТЬ — тоже ограничивает', () => {
    const r = ok(`
      ВЫБРАТЬ Т.Количество
      ИЗ (ВЫБРАТЬ ПЕРВЫЕ 2 С.Количество КАК Количество
          ИЗ Документ.РасходнаяНакладная.Товары КАК С) КАК Т
    `);
    expect(r.rows.length).toBe(2);
  });

  it('РАЗЛИЧНЫЕ внутри подзапроса — дедуп применяется', () => {
    const r = ok(`
      ВЫБРАТЬ Т.ВидДвижения
      ИЗ (ВЫБРАТЬ РАЗЛИЧНЫЕ Д.ВидДвижения КАК ВидДвижения
          ИЗ РегистрНакопления.ОстаткиТоваров КАК Д) КАК Т
    `);
    // В движениях есть только два вида: Приход и Расход
    expect(r.rows.length).toBe(2);
  });
});

describe('#69 — ВЫРАЗИТЬ и ПОДСТРОКА', () => {
  it('ПОДСТРОКА возвращает кусок строки (индексация с 1)', () => {
    const r = ok(`
      ВЫБРАТЬ ПОДСТРОКА(Т.Наименование, 1, 3) КАК Кусок
      ИЗ Справочник.Номенклатура КАК Т
      УПОРЯДОЧИТЬ ПО Т.Наименование
    `);
    // Все значения — непустые строки длиной ≤ 3
    for (const [chunk] of r.rows) {
      expect(typeof chunk).toBe('string');
      expect((chunk as string).length).toBeLessThanOrEqual(3);
      expect((chunk as string).length).toBeGreaterThan(0);
    }
  });

  it('ПОДСТРОКА(строка, 2, 4) даёт четыре символа со второго', () => {
    const r = ok(`
      ВЫБРАТЬ ПОДСТРОКА("Здравствуй", 2, 4) КАК Кусок
    `);
    expect(r.rows[0][0]).toBe('драв');
  });

  it('ВЫРАЗИТЬ КАК СТРОКА(N) обрезает строку до длины N', () => {
    const r = ok(`
      ВЫБРАТЬ ВЫРАЗИТЬ(Т.Наименование КАК СТРОКА(2)) КАК Кор,
              Т.Наименование КАК Полное
      ИЗ Справочник.Номенклатура КАК Т
    `);
    for (const [cropped, full] of r.rows) {
      expect(typeof cropped).toBe('string');
      expect((cropped as string).length).toBeLessThanOrEqual(2);
      expect(cropped).toBe((full as string).slice(0, 2));
    }
  });

  it('ВЫРАЗИТЬ КАК ЧИСЛО(M,N) округляет до N знаков', () => {
    const r = ok(`
      ВЫБРАТЬ ПЕРВЫЕ 1 ВЫРАЗИТЬ(3.14159 КАК ЧИСЛО(5,2)) КАК Пи
      ИЗ Справочник.Номенклатура КАК Т
    `);
    expect(r.rows[0][0]).toBe(3.14);
  });

  it('ВЫРАЗИТЬ КАК ЧИСЛО(M) — целочисленное приведение', () => {
    const r = ok(`
      ВЫБРАТЬ ПЕРВЫЕ 1 ВЫРАЗИТЬ(3.7 КАК ЧИСЛО(3)) КАК Три
      ИЗ Справочник.Номенклатура КАК Т
    `);
    expect(r.rows[0][0]).toBe(3);
  });

  it('ВЫРАЗИТЬ КАК БУЛЕВО прогоняет булево, а неподходящее → NULL', () => {
    const r = ok(`
      ВЫБРАТЬ ПЕРВЫЕ 1
              ВЫРАЗИТЬ(ИСТИНА КАК БУЛЕВО) КАК Т,
              ВЫРАЗИТЬ("привет" КАК БУЛЕВО) КАК Нет
      ИЗ Справочник.Номенклатура КАК Т
    `);
    expect(r.rows[0][0]).toBe(true);
    expect(r.rows[0][1]).toBe(NULL);
  });

  it('ВЫРАЗИТЬ КАК ДАТА пропускает ISO-строку', () => {
    const r = ok(`
      ВЫБРАТЬ ПЕРВЫЕ 1 ВЫРАЗИТЬ(ДАТАВРЕМЯ(2024,1,15) КАК ДАТА) КАК Д
      ИЗ Справочник.Номенклатура КАК Т
    `);
    expect(typeof r.rows[0][0]).toBe('string');
    expect(r.rows[0][0]).toMatch(/^2024-01-15/);
  });

  it('ВЫРАЗИТЬ КАК ссылка на метаданные — NULL + warning', () => {
    const r = runQuery(`
      ВЫБРАТЬ ПЕРВЫЕ 1 ВЫРАЗИТЬ(Т.Ссылка КАК Справочник.Контрагенты) КАК К
      ИЗ Справочник.Номенклатура КАК Т
    `, fx);
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
    expect(r.warnings.some((w) => /ВЫРАЗИТЬ.*метаданн/i.test(w))).toBe(true);
  });
});

describe('#73 — ЕСТЬ NULL после ЛЕВОГО СОЕДИНЕНИЯ без ложного предупреждения', () => {
  function warnings(source: string): string[] {
    const r = runQuery(source, fx);
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('\n'));
    return r.warnings;
  }

  it('LEFT JOIN с подзапросом справа — ЕСТЬ NULL без warning "не найдено"', () => {
    const source = `
      ВЫБРАТЬ Товары.Наименование
      ИЗ Справочник.Номенклатура КАК Товары
          ЛЕВОЕ СОЕДИНЕНИЕ
              (ВЫБРАТЬ РАЗЛИЧНЫЕ Д.Номенклатура КАК Ном
               ИЗ РегистрНакопления.ОстаткиТоваров КАК Д) КАК Продажи
              ПО Товары.Ссылка = Продажи.Ном
      ГДЕ Продажи.Ном ЕСТЬ NULL
    `;
    // Ответ верный: есть позиции без движений (n6..n8 и группы)
    const r = ok(source);
    expect(r.rows.length).toBeGreaterThan(0);
    // …и в предупреждениях нет ложного «не найдено»
    const ws = warnings(source);
    expect(ws.filter((w) => /не найдено/i.test(w))).toEqual([]);
  });

  it('LEFT JOIN с виртуальной таблицей .Остатки() справа — то же', () => {
    const source = `
      ВЫБРАТЬ Н.Наименование, О.КоличествоОстаток
      ИЗ Справочник.Номенклатура КАК Н
          ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ОстаткиТоваров.Остатки() КАК О
              ПО Н.Ссылка = О.Номенклатура
    `;
    ok(source);
    const ws = warnings(source);
    expect(ws.filter((w) => /КоличествоОстаток.*не найдено|не найдено.*КоличествоОстаток/i.test(w))).toEqual([]);
  });

  it('Опечатка в имени поля по-прежнему даёт warning', () => {
    // Проверяем что фикс не глушит настоящие ошибки в имени
    const source = `
      ВЫБРАТЬ Т.НетТакогоПоля
      ИЗ Справочник.Номенклатура КАК Т
    `;
    const ws = warnings(source);
    expect(ws.some((w) => /НетТакогоПоля.*не найдено/i.test(w))).toBe(true);
  });
});
