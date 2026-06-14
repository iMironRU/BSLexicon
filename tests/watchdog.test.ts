/**
 * Watchdog: бюджет шагов не даёт бесконечному циклу повесить главный поток.
 * Гоняем интерпретатор напрямую с низким лимитом — быстро и детерминированно.
 */
import { describe, it, expect } from 'vitest';
import { Interpreter } from '../src/core/interpreter/interpreter';
import { lex } from '../src/core/lexer/lexer';
import { parse } from '../src/core/parser/parser';
import { RuntimeError } from '../src/core/errors';

function drain(source: string, stepLimit: number): void {
  const interp = new Interpreter({ stepLimit });
  const gen = interp.run(parse(lex(source)));
  let r = gen.next();
  while (!r.done) r = gen.next();
}

describe('watchdog: бюджет шагов', () => {
  it('роняет бесконечный «Пока» с непустым телом', () => {
    expect(() => drain('Пока Истина Цикл Х = 1; КонецЦикла;', 200)).toThrow(RuntimeError);
  });

  it('роняет бесконечный «Пока» с пустым телом (тик на итерацию)', () => {
    expect(() => drain('Пока Истина Цикл КонецЦикла;', 200)).toThrow(/лимит шагов/);
  });

  it('роняет «Для» с гигантским диапазоном и пустым телом', () => {
    expect(() => drain('Для С = 1 По 1000000000 Цикл КонецЦикла;', 200)).toThrow(/лимит шагов/);
  });

  it('не мешает нормальной программе в пределах бюджета', () => {
    expect(() =>
      drain('Итог = 0; Для С = 1 По 50 Цикл Итог = Итог + С; КонецЦикла;', 1000),
    ).not.toThrow();
  });
});
