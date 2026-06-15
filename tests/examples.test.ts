/**
 * Каждый пример-пресет редактора обязан исполняться без ошибок.
 * Это страхует от «протухания»: добавили возможность языка, дополнили «Обзор» —
 * если что-то сломалось в примере, тест сразу покажет.
 */
import { describe, expect, it } from 'vitest';
import { run } from '../src/core/index';
import { EXAMPLES } from '../src/app/examples';

describe('примеры редактора исполняются без ошибок', () => {
  it.each(EXAMPLES.map((e) => [e.title, e.code] as const))('«%s»', (_title, code) => {
    const result = run(code);
    if (!result.ok) {
      throw new Error(`${result.error.stage}: ${result.error.message}` +
        (result.error.line !== undefined ? ` (строка ${result.error.line})` : ''));
    }
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('первый пример («Вход») — лёгкий: не длиннее 15 строк', () => {
    const intro = EXAMPLES[0].code.trimEnd().split('\n');
    expect(intro.length).toBeLessThanOrEqual(15);
  });
});
