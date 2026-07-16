import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearDraft,
  deleteSnippet,
  exportAll,
  importAll,
  listSnippets,
  loadDraft,
  renameSnippet,
  saveDraft,
  saveSnippet,
} from '../src/app/snippets';

/**
 * Vitest у нас с environment: 'node' — localStorage нет. Кладём минималистичный
 * in-memory shim перед каждым тестом; после теста снимаем и удаляем данные,
 * чтобы тесты были изолированы.
 */
function installLocalStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  return store;
}

describe('snippets', () => {
  beforeEach(() => { installLocalStorage(); });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('draft: пустое хранилище → null', () => {
    expect(loadDraft()).toBeNull();
  });

  it('draft: save + load возвращают то же', () => {
    saveDraft('Сообщить("привет")');
    expect(loadDraft()).toBe('Сообщить("привет")');
  });

  it('draft: clear убирает значение', () => {
    saveDraft('x');
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('snippets: список пуст изначально', () => {
    expect(listSnippets()).toEqual([]);
  });

  it('snippets: save добавляет с id и createdAt, сверху списка', () => {
    saveSnippet('первый', 'code1', 1000);
    saveSnippet('второй', 'code2', 2000);
    const items = listSnippets();
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('второй');
    expect(items[1].name).toBe('первый');
    expect(items[0].id).toBeTruthy();
    expect(items[0].createdAt).toBe(2000);
  });

  it('snippets: пустое имя нормализуется в «Без имени»', () => {
    const s = saveSnippet('   ', 'x');
    expect(s.name).toBe('Без имени');
  });

  it('snippets: delete убирает по id, остальные остаются', () => {
    const a = saveSnippet('a', 'ca', 1);
    saveSnippet('b', 'cb', 2);
    deleteSnippet(a.id);
    const items = listSnippets();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('b');
  });

  it('snippets: rename меняет имя, игнорирует пустое', () => {
    const a = saveSnippet('старое', 'x', 1);
    renameSnippet(a.id, '  новое  ');
    expect(listSnippets()[0].name).toBe('новое');
    renameSnippet(a.id, '   ');
    expect(listSnippets()[0].name).toBe('новое'); // не изменилось
  });

  it('export/import: полный round-trip', () => {
    saveSnippet('a', 'code A', 1000);
    saveSnippet('b', 'code B', 2000);
    const json = exportAll();
    // Стираем хранилище и импортируем обратно
    installLocalStorage();
    const result = importAll(json);
    expect(result.error).toBeNull();
    expect(result.added).toBe(2);
    const items = listSnippets();
    expect(items.map((s) => s.name).sort()).toEqual(['a', 'b']);
    expect(items.map((s) => s.code).sort()).toEqual(['code A', 'code B']);
  });

  it('import: битый JSON → error, ничего не пишет', () => {
    saveSnippet('старый', 'x', 1000);
    const result = importAll('{not-json');
    expect(result.error).toBeTruthy();
    expect(listSnippets()).toHaveLength(1);
  });

  it('import: неверная структура → error', () => {
    const result = importAll('{"foo": 42}');
    expect(result.error).toBeTruthy();
    expect(result.added).toBe(0);
  });

  it('import: массив принимается как валидный', () => {
    const result = importAll('[{"name":"x","code":"y"}]');
    expect(result.error).toBeNull();
    expect(result.added).toBe(1);
    expect(listSnippets()[0].name).toBe('x');
  });

  it('import: битые item-ы пропускаются', () => {
    const json = JSON.stringify({
      version: 1,
      items: [
        { name: 'ok', code: 'x' },
        { name: 'bad-no-code' }, // без code
        'string', // не объект
        { name: 'ok2', code: '' },
      ],
    });
    const result = importAll(json);
    expect(result.error).toBeNull();
    expect(result.added).toBe(2); // ok + ok2
    expect(result.skipped).toBe(2);
  });

  it('import replace: старый список стирается', () => {
    saveSnippet('старый', 'x', 1000);
    importAll('[{"name":"новый","code":"y"}]', 'replace');
    const items = listSnippets();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('новый');
  });

  it('import merge: старые остаются, новые добавляются сверху', () => {
    saveSnippet('старый', 'x', 1000);
    importAll('[{"name":"новый","code":"y"}]', 'merge');
    const names = listSnippets().map((s) => s.name);
    expect(names).toEqual(['новый', 'старый']);
  });

  it('storage недоступен → save и load не бросают', () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(() => saveDraft('x')).not.toThrow();
    expect(loadDraft()).toBeNull();
    expect(() => saveSnippet('a', 'b')).not.toThrow();
    expect(listSnippets()).toEqual([]);
  });
});
