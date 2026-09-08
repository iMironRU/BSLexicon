import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '../src/notebook/draft';
import { newCell } from '../src/notebook/serialize';
import type { Notebook } from '../src/notebook/types';

/**
 * jsdom / node env: у vitest по умолчанию localStorage может отсутствовать.
 * Подкладываем минимальный shim только для этих тестов.
 */
class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  key(): string | null { return null; }
  get length(): number { return this.map.size; }
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = new MemStorage();
});

describe('notebook draft', () => {
  it('save → load — round-trip трёх типов ячеек', () => {
    const nb: Notebook = {
      cells: [
        newCell('markdown', '# Заголовок'),
        newCell('code', 'Х = 10;'),
        newCell('task', 'Сообщить(42);', {
          statement: 'Выведи 42',
          starter: '// ...',
          tests: [{ kind: 'stdout', expect: '42' }],
        }),
      ],
    };
    saveDraft(nb);
    const loaded = loadDraft();
    expect(loaded).not.toBeNull();
    expect(loaded!.cells).toHaveLength(3);
    expect(loaded!.cells.map((c) => c.type)).toEqual(['markdown', 'code', 'task']);
    expect(loaded!.cells[1].source).toBe('Х = 10;');
    const task = loaded!.cells[2];
    if (task.type === 'task') {
      expect(task.task.tests[0]).toEqual({ kind: 'stdout', expect: '42' });
    }
  });

  it('save → clear → load — null', () => {
    saveDraft({ cells: [newCell('code', 'Х = 1;')] });
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('load из пустого storage — null', () => {
    expect(loadDraft()).toBeNull();
  });

  it('битый JSON в storage — null, не бросает', () => {
    localStorage.setItem('bslexicon:notebook:draft', '{{{невалидный json');
    expect(loadDraft()).toBeNull();
  });

  it('неверная схема (v: 2) — null', () => {
    localStorage.setItem('bslexicon:notebook:draft', '{"v":2,"cells":[]}');
    expect(loadDraft()).toBeNull();
  });

  it('id при load генерится новый (не полагаемся на storage)', () => {
    saveDraft({ cells: [newCell('code', 'x')] });
    const loaded = loadDraft();
    expect(loaded!.cells[0].id).toMatch(/^d\d+$/);
  });

  it('saveDraft при недоступном storage — молчаливое no-op', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = { setItem: () => { throw new Error('quota'); }, getItem: () => null, removeItem: () => {} };
    expect(() => saveDraft({ cells: [newCell('code', 'x')] })).not.toThrow();
    expect(loadDraft()).toBeNull();
  });
});
