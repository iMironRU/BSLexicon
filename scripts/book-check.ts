/**
 * CLI-валидация репо книги (#62).
 *
 * Обходит директорию, находит:
 *   - `book.yaml` в корне (или переданный аргументом)
 *   - `.nb.json` — парсит и валидирует сериализацию
 *   - `.query-task.yaml` — парсит формат, потом прогоняет `starter`
 *     через interpreter (парсер + рантайм) на fixture из спеки
 *
 * Печатает человекочитаемый отчёт, а с флагом `--json` — JSON для CI.
 * Exit-code 0 если ошибок нет, 1 — если есть.
 *
 * Использование:
 *   tsx scripts/book-check.ts [path=.]  [--json]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBookYaml } from '../src/book/book-format';
import { parseQueryTaskYaml } from '../src/query/task-format';
import { runQueryTask } from '../src/query/task-runner';
import { parseAnyFile } from '../src/notebook/git-notebooks';

interface Finding {
  file: string;
  level: 'error' | 'warn' | 'ok';
  message: string;
}

interface Report {
  root: string;
  book?: string;
  files: {
    notebooks: number;
    queryTasks: number;
  };
  findings: Finding[];
  summary: { errors: number; warnings: number; ok: number };
}

const [, , ...argv] = process.argv;
const asJson = argv.includes('--json');
const rootArg = argv.find((a) => !a.startsWith('--')) ?? '.';
const root = resolve(rootArg);

main().then((r) => {
  if (asJson) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    printHuman(r);
  }
  process.exit(r.summary.errors > 0 ? 1 : 0);
});

async function main(): Promise<Report> {
  const findings: Finding[] = [];
  const report: Report = {
    root,
    files: { notebooks: 0, queryTasks: 0 },
    findings,
    summary: { errors: 0, warnings: 0, ok: 0 },
  };

  // 1. book.yaml — если есть, валидируем.
  const bookYamlPath = join(root, 'book.yaml');
  if (fileExists(bookYamlPath)) {
    report.book = 'book.yaml';
    const text = readFileSync(bookYamlPath, 'utf8');
    const parsed = parseBookYaml(text);
    if (!parsed.ok) {
      findings.push({ file: 'book.yaml', level: 'error', message: parsed.error });
    } else {
      findings.push({ file: 'book.yaml', level: 'ok', message: `${parsed.value.chapters.length} глав` });
      // Проверяем, что каждая глава ссылается на существующий notebook
      for (const ch of parsed.value.chapters) {
        const nbPath = join(root, ch.notebook);
        if (!fileExists(nbPath)) {
          findings.push({ file: ch.notebook, level: 'error', message: `notebook не найден (упоминается в book.yaml, глава «${ch.title}»)` });
        }
      }
    }
  }

  // 2. Ищем .nb.json и .query-task.yaml по всему дереву.
  for (const file of walk(root)) {
    const rel = file.slice(root.length + 1);
    if (file.endsWith('.nb.json')) {
      report.files.notebooks += 1;
      try {
        const text = readFileSync(file, 'utf8');
        const parsed = parseAnyFile(text);
        findings.push({ file: rel, level: 'ok', message: `${parsed.notebook.cells.length} ячеек` });
      } catch (e) {
        findings.push({ file: rel, level: 'error', message: (e as Error).message });
      }
      continue;
    }
    if (file.endsWith('.query-task.yaml')) {
      report.files.queryTasks += 1;
      const text = readFileSync(file, 'utf8');
      const parsed = parseQueryTaskYaml(text);
      if (!parsed.ok) {
        findings.push({ file: rel, level: 'error', message: `format: ${parsed.error}` });
        continue;
      }
      // Прогоняем starter через интерпретатор
      const result = runQueryTask(parsed.value.starter, parsed.value);
      if (result.status === 'error') {
        const msg = result.specError
          ?? result.errors?.map((e) => `[${e.stage}] ${e.message}`).join('; ')
          ?? 'unknown';
        findings.push({ file: rel, level: 'error', message: `starter: ${msg}` });
      } else if (result.status === 'fail') {
        findings.push({ file: rel, level: 'warn', message: `starter не проходит (это ок для стартеров-заготовок)` });
      } else {
        findings.push({ file: rel, level: 'ok', message: `starter проходит эталон` });
      }
      continue;
    }
  }

  for (const f of findings) {
    if (f.level === 'error') report.summary.errors += 1;
    else if (f.level === 'warn') report.summary.warnings += 1;
    else report.summary.ok += 1;
  }
  return report;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(cur);
    } catch { continue; }
    for (const name of entries) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const full = join(cur, name);
      const st = statSync(full);
      if (st.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function fileExists(p: string): boolean {
  try { statSync(p); return true; } catch { return false; }
}

function printHuman(r: Report): void {
  const line = (s = '') => process.stdout.write(s + '\n');
  line(`📚 book-check ${r.root}`);
  line(`   Ноутбуков: ${r.files.notebooks}, задач-запросов: ${r.files.queryTasks}`);
  line();
  for (const f of r.findings) {
    const icon = f.level === 'error' ? '✗' : f.level === 'warn' ? '⚠' : '✓';
    line(`  ${icon} ${f.file} — ${f.message}`);
  }
  line();
  line(`Итого: ✓ ${r.summary.ok}, ⚠ ${r.summary.warnings}, ✗ ${r.summary.errors}`);
}
