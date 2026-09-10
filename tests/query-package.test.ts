/**
 * Тесты пакетов запросов и временных таблиц (#46).
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

describe('Пакет запросов', () => {
  it('ПОМЕСТИТЬ ВТ и последующий SELECT из ВТ', () => {
    const r = ok(`
      ВЫБРАТЬ Наименование КАК Имя
      ПОМЕСТИТЬ ВТ_Товары
      ИЗ Справочник.Номенклатура
      ГДЕ ПометкаУдаления = ЛОЖЬ
      ;
      ВЫБРАТЬ Имя
      ИЗ ВТ_Товары
    `);
    expect(r.rows.length).toBe(7);
  });

  it('несколько ПОМЕСТИТЬ + финальное SELECT', () => {
    const r = ok(`
      ВЫБРАТЬ Ссылка КАК Т, Наименование КАК Имя
      ПОМЕСТИТЬ ВТ_Т
      ИЗ Справочник.Номенклатура
      ;
      ВЫБРАТЬ Ссылка КАК С, Наименование КАК Имя
      ПОМЕСТИТЬ ВТ_С
      ИЗ Справочник.Склады
      ;
      ВЫБРАТЬ Т.Имя, С.Имя
      ИЗ ВТ_Т КАК Т, ВТ_С КАК С
    `);
    // Декартово произведение 8 × 2 = 16
    expect(r.rows.length).toBe(16);
  });

  it('УНИЧТОЖИТЬ ВТ_ — предыдущая недоступна', () => {
    const r = runQuery(`
      ВЫБРАТЬ Наименование КАК Имя
      ПОМЕСТИТЬ ВТ_Товары
      ИЗ Справочник.Номенклатура
      ;
      УНИЧТОЖИТЬ ВТ_Товары
      ;
      ВЫБРАТЬ Имя ИЗ ВТ_Товары
    `, fx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => /ВТ_Товары/i.test(e.message))).toBe(true);
    }
  });

  it('пакет без финального SELECT — ошибка', () => {
    const r = runQuery(`
      ВЫБРАТЬ Наименование ПОМЕСТИТЬ ВТ ИЗ Справочник.Номенклатура
    `, fx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /финальн/i.test(e.message))).toBe(true);
  });

  it('SELECT из несуществующей ВТ — понятная ошибка', () => {
    const r = runQuery(`ВЫБРАТЬ Имя ИЗ ВТ_НетТакой`, fx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /Временная таблица|ВТ_НетТакой/i.test(e.message))).toBe(true);
  });
});
