/**
 * Тесты пакетов запросов и временных таблиц (#46).
 */
import { describe, expect, it } from 'vitest';
import { runQuery } from '../src/query/interpreter';
import { loadMiniErpFixture, runOk } from './fixtures/mini-erp';

const fx = loadMiniErpFixture();
const ok = (source: string) => runOk(source, fx);

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
