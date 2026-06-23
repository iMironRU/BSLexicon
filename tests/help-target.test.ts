import { describe, expect, it } from 'vitest';
import type { SyntaxEntry } from '../src/app/reference/types';
import {
  compareVersion,
  defaultTarget,
  isAvailable,
  verdict,
  versionsFromEntries,
} from '../src/help/target';
import type { ContextKey, Target } from '../src/help/target';

function entry(over: Partial<SyntaxEntry>): SyntaxEntry {
  return {
    owner: 'Глобальный контекст',
    ownerEn: 'Global context',
    kind: 'function',
    category: 'Прочее',
    nameRu: 'Тест',
    nameEn: 'Test',
    signature: null,
    params: [],
    returnType: null,
    availability: [],
    availabilityKeys: [],
    since: null,
    ...over,
  };
}

function target(version: string | null, contexts: ContextKey[] = []): Target {
  return { version, contexts: new Set(contexts) };
}

describe('compareVersion', () => {
  it('равные', () => {
    expect(compareVersion('8.3.18', '8.3.18')).toBe(0);
  });
  it('паддинг нулями: 8.3 = 8.3.0', () => {
    expect(compareVersion('8.3', '8.3.0')).toBe(0);
    expect(compareVersion('8.3.0', '8.3')).toBe(0);
  });
  it('8.3.18 < 8.3.20', () => {
    expect(compareVersion('8.3.18', '8.3.20')).toBeLessThan(0);
  });
  it('8.0 < 8.3.0', () => {
    expect(compareVersion('8.0', '8.3.0')).toBeLessThan(0);
  });
  it('лексическое сравнение не путает: 8.3.10 > 8.3.9', () => {
    expect(compareVersion('8.3.10', '8.3.9')).toBeGreaterThan(0);
  });
});

describe('isAvailable / verdict', () => {
  it('нет данных → unknown', () => {
    expect(isAvailable(entry({}), defaultTarget())).toBe('unknown');
  });

  it('without target — всегда yes (если есть какие-то данные)', () => {
    const e = entry({ since: '8.0', availabilityKeys: ['server'] });
    expect(isAvailable(e, defaultTarget())).toBe('yes');
  });

  it('требует более свежей версии → no с причиной needsVersion', () => {
    const e = entry({ since: '8.3.23', availabilityKeys: ['server'] });
    const v = verdict(e, target('8.3.18'));
    expect(v.verdict).toBe('no');
    expect(v.reason.needsVersion).toBe('8.3.23');
  });

  it('версия 8.3.18 удовлетворяет since=8.0', () => {
    const e = entry({ since: '8.0', availabilityKeys: ['server'] });
    expect(isAvailable(e, target('8.3.18'))).toBe('yes');
  });

  it('выбранный контекст отсутствует у записи → no с missingContexts', () => {
    const e = entry({ since: '8.0', availabilityKeys: ['server', 'external'] });
    const v = verdict(e, target(null, ['thin']));
    expect(v.verdict).toBe('no');
    expect(v.reason.missingContexts).toEqual(['thin']);
  });

  it('строгий AND: target {thin, server} требует обоих', () => {
    const eOnlyServer = entry({ since: '8.0', availabilityKeys: ['server'] });
    expect(isAvailable(eOnlyServer, target(null, ['thin', 'server']))).toBe('no');

    const eBoth = entry({ since: '8.0', availabilityKeys: ['server', 'thin'] });
    expect(isAvailable(eBoth, target(null, ['thin', 'server']))).toBe('yes');
  });

  it('пустой target.contexts → не фильтрует по контекстам', () => {
    const e = entry({ since: '8.0', availabilityKeys: ['server'] });
    expect(isAvailable(e, target('8.3.18'))).toBe('yes');
  });

  it('версия проверяется раньше контекстов', () => {
    // Если версия не подходит, причина — needsVersion, даже если контексты тоже не совпадают
    const e = entry({ since: '8.3.23', availabilityKeys: ['server'] });
    const v = verdict(e, target('8.3.18', ['thin']));
    expect(v.verdict).toBe('no');
    expect(v.reason.needsVersion).toBe('8.3.23');
    expect(v.reason.missingContexts).toBeUndefined();
  });
});

describe('versionsFromEntries', () => {
  it('сортирует по убыванию и дедуплицирует', () => {
    const es = [
      entry({ since: '8.0' }),
      entry({ since: '8.3.20' }),
      entry({ since: '8.3.10' }),
      entry({ since: '8.0' }),
      entry({ since: null }),
      entry({ since: '8.1' }),
    ];
    expect(versionsFromEntries(es)).toEqual(['8.3.20', '8.3.10', '8.1', '8.0']);
  });

  it('пустой список', () => {
    expect(versionsFromEntries([])).toEqual([]);
  });
});
