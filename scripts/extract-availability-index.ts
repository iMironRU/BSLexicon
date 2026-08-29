/**
 * Компактный индекс «доступности» для warnings в редакторе тренажёра.
 *
 * Из `public/reference/syntax-help-full.json` вытаскиваем только то,
 * что нужно провайдеру Monaco: имя (ru), тип записи, `since`, набор
 * контекстов. Ничего лишнего — итоговый JSON лежит в bundle и парсится
 * при загрузке тренажёра.
 *
 * Формат:
 *   {
 *     functions: { [nameLower]: { name, since?, contexts?[] } },
 *     types:     { [nameLower]: { name, since?, contexts?[] } }
 *   }
 *
 * Отдельно functions и types — в тренажёре MVP-warnings различают
 * «прямой вызов по имени» (глобальная функция) и `Новый <Тип>()`.
 * Методы объектов не в индексе — их проверка требует type inference,
 * см. #10 в issues.
 *
 * Пустые записи (нет since, availabilityKeys пуст) не включаются —
 * они и не могут вызвать warning.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SyntaxEntry } from '../src/app/reference/types';

const root = fileURLToPath(new URL('..', import.meta.url));
const inPath = join(root, 'public', 'reference', 'syntax-help-full.json');
const outPath = join(root, 'public', 'reference', 'syntax-availability.json');

if (!existsSync(inPath)) {
  console.error(`Не найден ${inPath}. Сначала запусти npm run extract:hbk-full.`);
  process.exit(1);
}

interface FullFile { entries: SyntaxEntry[] }

const data = JSON.parse(readFileSync(inPath, 'utf8')) as FullFile;

interface IndexEntry {
  name: string;
  since?: string;
  contexts?: string[];
}

interface Index {
  functions: Record<string, IndexEntry>;
  types: Record<string, IndexEntry>;
}

const out: Index = { functions: {}, types: {} };
const uniqueTypes = new Set<string>();

for (const e of data.entries) {
  const hasLimit = e.since !== null || (e.availabilityKeys && e.availabilityKeys.length > 0);
  if (!hasLimit) continue;

  const entry: IndexEntry = { name: e.nameRu };
  if (e.since) entry.since = e.since;
  if (e.availabilityKeys && e.availabilityKeys.length > 0) entry.contexts = e.availabilityKeys;

  if (e.kind === 'function') {
    out.functions[e.nameRu.toLowerCase()] = entry;
  }

  // Тип-владелец у method/property/event выгрузки — берём его как «тип»
  // для проверки `Новый <Тип>`. Дедуп по имени: если у типа встретилось
  // несколько ограничений (обычно since от «главной» страницы), берём первое.
  if (e.owner && !e.owner.startsWith('Глобальный') && !uniqueTypes.has(e.owner.toLowerCase())) {
    const typeHasLimit = e.since !== null || (e.availabilityKeys && e.availabilityKeys.length > 0);
    if (typeHasLimit) {
      // Ищем страницу самого типа (owner=nameRu=e.owner, kind различный).
      // Здесь мы упрощаем: если у одной из записей owner есть since/contexts,
      // считаем это ограничением всего типа. Так делает и /help/full/.
      const typeEntry: IndexEntry = { name: e.owner };
      if (e.since) typeEntry.since = e.since;
      if (e.availabilityKeys && e.availabilityKeys.length > 0) typeEntry.contexts = e.availabilityKeys;
      out.types[e.owner.toLowerCase()] = typeEntry;
      uniqueTypes.add(e.owner.toLowerCase());
    }
  }
}

writeFileSync(outPath, JSON.stringify(out));

const size = Buffer.byteLength(JSON.stringify(out), 'utf8');
const fnCount = Object.keys(out.functions).length;
const tyCount = Object.keys(out.types).length;
console.log(`✓ Availability index: ${fnCount} функций + ${tyCount} типов (${(size / 1024).toFixed(1)} КБ)`);
console.log(`  → ${outPath.slice(root.length + 1)}`);
