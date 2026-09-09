import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFixture, type Fixture } from '../src/query/fixture';
import { parseDataYaml, parseSchemaYaml } from '../src/query/schema-loader';
import { present } from '../src/query-app/presentation';
import { NULL, UNDEFINED } from '../src/core/interpreter/values';

let fx: Fixture;

beforeAll(() => {
  const schemaYaml = readFileSync(join(__dirname, '../examples/query-demo/mini-erp.schema.yaml'), 'utf8');
  const dataYaml = readFileSync(join(__dirname, '../examples/query-demo/mini-erp.data.yaml'), 'utf8');
  const s = parseSchemaYaml(schemaYaml);
  const d = parseDataYaml(dataYaml);
  if (!s.ok || !d.ok) throw new Error('demo fixtures broken');
  fx = buildFixture(s.value, d.value);
});

describe('present() — представление ссылок', () => {
  it('справочник → Наименование, raw и targetRef заполнены', () => {
    const p = present('n1', fx);
    expect(p.display).toBe('Молоток');
    expect(p.raw).toBe('n1');
    expect(p.targetRef).toBe('Справочник.Номенклатура');
  });

  it('справочник Склады → Наименование', () => {
    const p = present('s_main', fx);
    expect(p.display).toBe('Основной');
    expect(p.raw).toBe('s_main');
  });

  it('документ → «№<НомерБезНулей> от <ДД.ММ.ГГГГ>»', () => {
    const p = present('d1', fx);
    expect(p.display).toBe('№1 от 15.01.2024');
    expect(p.targetRef).toBe('Документ.РасходнаяНакладная');
  });

  it('незнакомая строка — возвращается как есть, raw = null', () => {
    const p = present('такого-нет', fx);
    expect(p.display).toBe('такого-нет');
    expect(p.raw).toBeNull();
    expect(p.targetRef).toBeNull();
  });

  it('число — форматируется без scientific-нотации, raw = null', () => {
    const p = present(42, fx);
    expect(p.display).toBe('42');
    expect(p.raw).toBeNull();
  });

  it('дробное число — обрезает лишние нули', () => {
    const p = present(1.5, fx);
    expect(p.display).toBe('1.5');
  });

  it('булево → Истина/Ложь', () => {
    expect(present(true, fx).display).toBe('Истина');
    expect(present(false, fx).display).toBe('Ложь');
  });

  it('NULL / Неопределено → пустая строка', () => {
    expect(present(NULL, fx).display).toBe('');
    expect(present(UNDEFINED, fx).display).toBe('');
  });

  it('пустая строка — не резолвится, но не падает', () => {
    const p = present('', fx);
    expect(p.raw).toBeNull();
  });
});
