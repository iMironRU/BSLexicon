import { describe, expect, it } from 'vitest';
import type { AvailabilityIndex } from '../src/app/availability';
import { checkName, reasonToMessage } from '../src/app/availability';
import { scanForWarnings } from '../src/app/availability/scan';
import type { Target } from '../src/help/target';
import type { ContextKey } from '../src/help/target';

const INDEX: AvailabilityIndex = {
  functions: {
    'стрразделить': { name: 'СтрРазделить', since: '8.3.15', contexts: ['thin', 'thick', 'server', 'web'] },
    'сообщить':     { name: 'Сообщить', contexts: ['thin', 'thick', 'server', 'web'] },
    'фоновоезадание': { name: 'ФоновоеЗадание', contexts: ['server'] },
  },
  types: {
    'ходlvалидатор': { name: 'НовыйТипДо8_3_20', since: '8.3.20' },
  },
};

function t(version: string | null, contexts: ContextKey[]): Target {
  return { version, contexts: new Set(contexts) };
}

describe('checkName', () => {
  it('в записи нет ни since, ни contexts → игнорируется (не в индексе)', () => {
    expect(checkName('function', 'НетТакой', t('8.0', ['server']), INDEX)).toBeNull();
  });

  it('версия достаточна → null', () => {
    expect(checkName('function', 'СтрРазделить', t('8.3.20', []), INDEX)).toBeNull();
  });

  it('версия ниже since → warning с needsVersion', () => {
    const r = checkName('function', 'СтрРазделить', t('8.3.14', []), INDEX);
    expect(r?.needsVersion).toBe('8.3.15');
  });

  it('версия не задана → игнорируется по версии', () => {
    expect(checkName('function', 'СтрРазделить', t(null, []), INDEX)).toBeNull();
  });

  it('контекст не пересекается → warning с missingContexts', () => {
    const r = checkName('function', 'ФоновоеЗадание', t(null, ['thin']), INDEX);
    expect(r?.missingContexts).toEqual(['thin']);
  });

  it('контекст пересекается → null', () => {
    expect(checkName('function', 'ФоновоеЗадание', t(null, ['server']), INDEX)).toBeNull();
  });

  it('пустой набор контекстов = не проверять контекст', () => {
    expect(checkName('function', 'ФоновоеЗадание', t(null, []), INDEX)).toBeNull();
  });

  it('регистронезависимо', () => {
    expect(checkName('function', 'стрРазделить', t('8.3.14', []), INDEX)?.needsVersion).toBe('8.3.15');
  });
});

describe('reasonToMessage', () => {
  it('needsVersion → сообщение про версию', () => {
    const msg = reasonToMessage({ kind: 'function', name: 'X', needsVersion: '8.3.20' });
    expect(msg).toContain('8.3.20');
  });
  it('missingContexts → сообщение про контекст', () => {
    const msg = reasonToMessage({ kind: 'function', name: 'X', missingContexts: ['server' as ContextKey] });
    expect(msg).toContain('server');
  });
});

describe('scanForWarnings', () => {
  it('прямой вызов недоступной функции → warning', () => {
    const src = 'Сообщить(СтрРазделить("а,б", ","));';
    const w = scanForWarnings(src, t('8.3.14', []), INDEX);
    expect(w).toHaveLength(1);
    expect(w[0].reason.name).toBe('СтрРазделить');
    expect(w[0].line).toBe(1);
    expect(w[0].column).toBeGreaterThan(0);
    expect(w[0].length).toBe('СтрРазделить'.length);
  });

  it('вызов доступной функции → без warning', () => {
    const src = 'Сообщить("привет");';
    expect(scanForWarnings(src, t('8.3.20', ['thin']), INDEX)).toEqual([]);
  });

  it('битый код (parse-error) → warnings пусты, редактор сам покажет ошибку', () => {
    const src = 'Если 1 > 0 Сообщить("нет Тогда");';
    expect(scanForWarnings(src, t('8.3.14', []), INDEX)).toEqual([]);
  });

  it('вложенные вызовы обходятся', () => {
    const src = 'Сообщить(СтрРазделить(СтрРазделить("а,б", ",")[0], ","));';
    const w = scanForWarnings(src, t('8.3.14', []), INDEX);
    expect(w.length).toBeGreaterThanOrEqual(2); // оба СтрРазделить
  });

  it('контекст-only warning', () => {
    const src = 'ФоновоеЗадание();';
    const w = scanForWarnings(src, t(null, ['thin']), INDEX);
    expect(w).toHaveLength(1);
    expect(w[0].reason.missingContexts).toEqual(['thin']);
  });

  it('без Target-version не warn на since', () => {
    const src = 'Сообщить(СтрРазделить("а", ","));';
    expect(scanForWarnings(src, t(null, []), INDEX)).toEqual([]);
  });

  it('метод .Method() не проверяется (MVP не покрывает — нужен type inference)', () => {
    // Массив.Сортировать — гипотетически с since 8.3.14, но у нас в индексе только Call+New
    const src = 'М = Новый Массив; М.Сортировать();';
    expect(scanForWarnings(src, t('8.0', []), INDEX)).toEqual([]);
  });
});
