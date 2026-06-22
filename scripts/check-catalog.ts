/**
 * Проверка каталога языка — механизм отдельно от политики (концепция §5.3):
 *   1. каждая запись валидна по JSON-схеме;
 *   2. инвариант «рантайм ↔ каталог»: множество функций в рантайме точно
 *      совпадает с записями `kind: function` в каталоге;
 *   3. doctest: примеры с полем `expect` прогоняются тем же интерпретатором.
 *
 * Любое нарушение роняет процесс с кодом 1 — то есть и сборку в CI.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { load } from 'js-yaml';
import { builtinIds, methodIds, propertyIds, run } from '../src/core/index';
import type { CatalogEntry } from '../src/core/catalog/types';

const catalogDir = fileURLToPath(new URL('../catalog', import.meta.url));
const schemaPath = join(catalogDir, 'schema.json');

const errors: string[] = [];
const note = (msg: string): void => {
  errors.push(msg);
};

/** Рекурсивно собирает пути ко всем *.yaml в каталоге. */
function findYaml(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...findYaml(full));
    else if (name.endsWith('.yaml') || name.endsWith('.yml')) out.push(full);
  }
  return out;
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

const files = findYaml(catalogDir);
const entries: CatalogEntry[] = [];

for (const file of files) {
  const rel = file.slice(catalogDir.length + 1);
  let data: unknown;
  try {
    data = load(readFileSync(file, 'utf8'));
  } catch (e) {
    note(`${rel}: не удалось разобрать YAML — ${(e as Error).message}`);
    continue;
  }
  if (!validate(data)) {
    for (const err of validate.errors ?? []) {
      note(`${rel}${err.instancePath} ${err.message ?? 'не прошло валидацию'}`);
    }
    continue;
  }
  entries.push(...(data as CatalogEntry[]));
}

// --- Инвариант рантайм ↔ каталог ---
/** Сверяет два множества идентификаторов в обе стороны. */
function checkInvariant(kindLabel: string, runtime: Set<string>, catalog: Set<string>): void {
  for (const id of runtime) {
    if (!catalog.has(id)) note(`рантайм↔каталог: ${kindLabel} «${id}» есть в рантайме, но нет в каталоге`);
  }
  for (const id of catalog) {
    if (!runtime.has(id)) note(`рантайм↔каталог: ${kindLabel} «${id}» есть в каталоге, но нет в рантайме`);
  }
}

const catalogFns = new Set(entries.filter((e) => e.kind === 'function').map((e) => e.id));
const runtimeFns = new Set(builtinIds);
checkInvariant('функция', runtimeFns, catalogFns);

const catalogMethods = new Set(entries.filter((e) => e.kind === 'method').map((e) => e.id));
const runtimeMethods = new Set(methodIds);
checkInvariant('метод', runtimeMethods, catalogMethods);

const catalogProperties = new Set(entries.filter((e) => e.kind === 'property').map((e) => e.id));
const runtimeProperties = new Set(propertyIds);
checkInvariant('свойство', runtimeProperties, catalogProperties);

// --- Doctest примеров ---
let doctests = 0;
for (const entry of entries) {
  for (const ex of entry.examples ?? []) {
    if (ex.expect === undefined) continue;
    doctests += 1;
    const result = run(ex.code);
    if (!result.ok) {
      note(`doctest «${entry.id}»: ошибка ${result.error.stage} — ${result.error.message}`);
      continue;
    }
    const actual = result.output.join('\n');
    if (actual !== ex.expect) {
      note(`doctest «${entry.id}»: ожидалось «${ex.expect}», получено «${actual}»`);
    }
  }
}

// --- Итог ---
if (errors.length > 0) {
  console.error('✗ Проверка каталога не пройдена:\n');
  for (const e of errors) console.error('  • ' + e);
  console.error(`\n${errors.length} проблем(ы).`);
  process.exit(1);
}

console.log(
  `✓ Каталог в порядке: ${entries.length} записей, ` +
    `${runtimeFns.size} функций, ${runtimeMethods.size} методов и ${runtimeProperties.size} свойств совпадают с рантаймом, ` +
    `${doctests} doctest пройдено.`,
);
