/**
 * Общая фикстура «мини-ERP» для 12+ query-тестов. До этого каждый тест-файл
 * держал собственный `beforeAll` с одинаковыми пятью строками парсинга
 * YAML + сборкой Fixture. Теперь одна функция, вызывается один раз в
 * beforeAll (или прямо на модуле).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixture, type Fixture } from '../../src/query/fixture';
import { runQuery, type RunOptions } from '../../src/query/interpreter';
import { parseDataYaml, parseSchemaYaml } from '../../src/query/schema-loader';

/** Загружает `examples/query-demo/mini-erp.*.yaml` и собирает Fixture. */
export function loadMiniErpFixture(): Fixture {
  const s = parseSchemaYaml(readFileSync(join(__dirname, '../../examples/query-demo/mini-erp.schema.yaml'), 'utf8'));
  const d = parseDataYaml(readFileSync(join(__dirname, '../../examples/query-demo/mini-erp.data.yaml'), 'utf8'));
  if (!s.ok || !d.ok) throw new Error('demo fixtures broken');
  return buildFixture(s.value, d.value);
}

/**
 * `runOk(source, fx)` — прогоняет запрос и кидает при ошибке. Возвращает
 * rowset. Каждый query-тест раньше держал локальный `ok()` — теперь один.
 */
export function runOk(source: string, fx: Fixture, options?: RunOptions) {
  const r = runQuery(source, fx, options);
  if (!r.ok) {
    throw new Error(`Ошибки:\n${r.errors.map((e) => `[${e.stage}] ${e.message}`).join('\n')}\nЗапрос:\n${source}`);
  }
  return r.rowset;
}
