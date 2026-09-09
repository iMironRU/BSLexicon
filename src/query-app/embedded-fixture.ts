/**
 * Встроенная учебная демо-схема + данные (#41).
 *
 * YAML-файлы из `examples/query-demo/` подтягиваются как raw-строки
 * через Vite `?raw` — при билде попадают прямо в bundle. Никаких
 * network-запросов при открытии `/query/`.
 *
 * Один раз при загрузке страницы парсим YAML → строим Fixture и
 * кэшируем. Педагог, задающий свою схему через `?schema-src=`,
 * пойдёт другим путём (fetchNotebookFromSrc-подобный, отдельно).
 */
import schemaYaml from '../../examples/query-demo/mini-erp.schema.yaml?raw';
import dataYaml from '../../examples/query-demo/mini-erp.data.yaml?raw';
import { buildFixture, type Fixture } from '../query/fixture';
import { parseDataYaml, parseSchemaYaml, validateFixture } from '../query/schema-loader';

let cached: Fixture | null = null;

/** Мини-ERP из examples/query-demo. Один раз парсится за жизнь страницы. */
export function loadEmbeddedFixture(): Fixture {
  if (cached) return cached;
  const s = parseSchemaYaml(schemaYaml);
  if (!s.ok) throw new Error(`встроенная схема сломана: ${s.error}`);
  const d = parseDataYaml(dataYaml);
  if (!d.ok) throw new Error(`встроенные данные сломаны: ${d.error}`);
  const v = validateFixture(s.value, d.value);
  if (!v.ok) throw new Error(`встроенные данные не соответствуют схеме: ${v.error}`);
  cached = buildFixture(s.value, d.value);
  return cached;
}
