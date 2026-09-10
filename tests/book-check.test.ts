/**
 * Тесты CLI book-check (#62): проверяем, что скрипт корректно диагностирует
 * валидную и битую книги.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CWD = process.cwd();
const SCRIPT = join(CWD, 'scripts/book-check.ts');
const TSX = join(CWD, 'node_modules/.bin/tsx');

function run(dir: string): { code: number; report: ReturnType<typeof JSON.parse> } {
  try {
    const out = execFileSync(TSX, [SCRIPT, dir, '--json'], { encoding: 'utf8' });
    return { code: 0, report: JSON.parse(out) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, report: JSON.parse(err.stdout ?? '{}') };
  }
}

describe('book-check', () => {
  it('good book: exit 0, все findings ok', () => {
    const { code, report } = run('tests/fixtures/book-check-good');
    expect(code).toBe(0);
    expect(report.summary.errors).toBe(0);
    expect(report.files.notebooks).toBe(1);
    expect(report.files.queryTasks).toBe(1);
    expect(report.book).toBe('book.yaml');
  });

  it('broken book: exit 1, есть error findings', () => {
    const { code, report } = run('tests/fixtures/book-check-broken');
    expect(code).toBe(1);
    expect(report.summary.errors).toBeGreaterThan(0);
    // Ожидаем: notebook из book.yaml не найден + starter с опечаткой
    const files = report.findings.map((f: { file: string }) => f.file);
    expect(files.some((f: string) => f.includes('notebooks/missing.nb.json'))).toBe(true);
    expect(files.some((f: string) => f.includes('bad.query-task.yaml'))).toBe(true);
  });
});
