/**
 * После `antlr4ng` дописывает `// @ts-nocheck` первой строкой в каждый
 * сгенерированный `.ts` файл. ANTLR-generator оставляет неиспользуемые
 * параметры/импорты, а наш tsconfig строгий (`noUnusedParameters`).
 * Модифицировать генератор мы не хотим — вместо этого просто
 * отключаем typecheck на сгенерированных файлах. На поведение runtime
 * это никак не влияет.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Использование: tsx scripts/mark-generated.ts <dir>');
  process.exit(1);
}

const MARKER = '// @ts-nocheck — сгенерировано antlr4ng, не редактируется руками';

for (const name of readdirSync(dir)) {
  if (!name.endsWith('.ts')) continue;
  const path = join(dir, name);
  const text = readFileSync(path, 'utf8');
  if (text.startsWith('// @ts-nocheck')) continue;
  writeFileSync(path, `${MARKER}\n${text}`);
  console.log(`marked ${path}`);
}
