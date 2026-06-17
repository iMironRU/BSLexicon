/**
 * Примеры (пресеты редактора и сниппеты каталога):
 *  1. каждый обязан исполняться без ошибок — страховка от «протухания» при
 *     развитии языка;
 *  2. ни одна переменная не названа зарезервированным именем (ключевое слово,
 *     функция или тип каталога) — иначе пример сбивает с толку учащегося.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildCatalog, parseCatalog, run } from '../src/core/index';
import { lex } from '../src/core/lexer/lexer';
import { KEYWORDS } from '../src/core/lexer/keywords';
import { parse } from '../src/core/parser/parser';
import type { Stmt } from '../src/core/parser/ast';
import { EXAMPLES } from '../src/app/examples';

describe('примеры редактора исполняются без ошибок', () => {
  it.each(EXAMPLES.map((e) => [e.title, e.code] as const))('«%s»', (_title, code) => {
    const result = run(code);
    if (!result.ok) {
      throw new Error(
        `${result.error.stage}: ${result.error.message}` +
          (result.error.line !== undefined ? ` (строка ${result.error.line})` : ''),
      );
    }
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('первый пример («Вход») — лёгкий: не длиннее 15 строк', () => {
    const intro = EXAMPLES[0].code.trimEnd().split('\n');
    expect(intro.length).toBeLessThanOrEqual(15);
  });
});

// --- Зарезервированные имена не должны использоваться как переменные ---

function readCatalogFiles(): string[] {
  const dir = fileURLToPath(new URL('../catalog', import.meta.url));
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.yaml') || name.endsWith('.yml')) out.push(readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

/** Имена, недопустимые как имя переменной: ключевые слова + функции + типы каталога. */
const RESERVED = new Set<string>(KEYWORDS.keys());
{
  const catalog = buildCatalog(parseCatalog(readCatalogFiles()));
  for (const e of [...catalog.functions, ...catalog.types]) {
    RESERVED.add(e.names.ru.toLowerCase());
    RESERVED.add(e.names.en.toLowerCase());
  }
}

/** Собирает все «связываемые» имена: Перем, присваивания, счётчики циклов, процедуры/параметры. */
function collectBoundNames(stmts: Stmt[], out: Set<string>): void {
  for (const s of stmts) {
    switch (s.kind) {
      case 'VarDecl':
        for (const n of s.names) out.add(n.toLowerCase());
        break;
      case 'Assign':
        if (s.target.kind === 'Ident') out.add(s.target.name.toLowerCase());
        break;
      case 'For':
      case 'ForEach':
        out.add(s.varName.toLowerCase());
        collectBoundNames(s.body, out);
        break;
      case 'While':
        collectBoundNames(s.body, out);
        break;
      case 'If':
        for (const b of s.branches) collectBoundNames(b.body, out);
        if (s.elseBody) collectBoundNames(s.elseBody, out);
        break;
      case 'Try':
        collectBoundNames(s.body, out);
        collectBoundNames(s.handler, out);
        break;
      case 'ProcDecl':
        out.add(s.name.toLowerCase());
        for (const p of s.params) out.add(p.name.toLowerCase());
        collectBoundNames(s.body, out);
        break;
      default:
        break;
    }
  }
}

const SNIPPETS: [string, string][] = [
  ...EXAMPLES.map((e) => [`пример «${e.title}»`, e.code] as [string, string]),
  ...buildCatalog(parseCatalog(readCatalogFiles())).entries.flatMap((entry) =>
    (entry.examples ?? []).map(
      (ex, i) => [`каталог «${entry.id}» #${i + 1}`, ex.code] as [string, string],
    ),
  ),
];

describe('переменные не названы зарезервированными словами', () => {
  it.each(SNIPPETS)('%s', (_where, code) => {
    const bound = new Set<string>();
    collectBoundNames(parse(lex(code)), bound);
    const clash = [...bound].filter((n) => RESERVED.has(n));
    expect(clash).toEqual([]);
  });
});
