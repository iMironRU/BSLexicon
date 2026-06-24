import { describe, expect, it } from 'vitest';
import { buildTree } from '../src/full-help/tree';

describe('buildTree', () => {
  it('строит иерархию из catalog-пути', () => {
    const tree = buildTree({
      ownerPaths: {
        ТабличныйДокумент: ['catalog63', 'catalog64'],
        ТекстовыйДокумент: ['catalog63', 'catalog65'],
        Массив: ['catalog234'],
      },
      categoryNames: {
        catalog63: 'Общие объекты',
        catalog64: 'Документы',
        catalog65: 'Тексты',
        catalog234: 'Универсальные коллекции',
      },
      entriesByOwner: new Map(),
    });

    expect(tree).toHaveLength(2);
    const общие = tree.find((t) => t.label === 'Общие объекты');
    expect(общие).toBeDefined();
    expect(общие?.ownerCount).toBe(2);
    expect(общие?.children.map((c) => c.label)).toEqual(['Документы', 'Тексты']);

    const универсальные = tree.find((t) => t.label === 'Универсальные коллекции');
    expect(универсальные?.children[0].isOwner).toBe(true);
    expect(универсальные?.children[0].ownerName).toBe('Массив');
  });

  it('owner-ы без catalog-пути идут в раздел «Прочее»', () => {
    const tree = buildTree({
      ownerPaths: {
        'Глобальный контекст': [],
        Массив: ['catalog234'],
      },
      categoryNames: { catalog234: 'Универсальные коллекции' },
      entriesByOwner: new Map(),
    });

    const прочее = tree.find((t) => t.label === 'Прочее');
    expect(прочее).toBeDefined();
    expect(прочее?.children[0].ownerName).toBe('Глобальный контекст');
    // «Прочее» всегда в конце
    expect(tree[tree.length - 1].label).toBe('Прочее');
  });

  it('категории впереди owner-ов на каждом уровне', () => {
    const tree = buildTree({
      ownerPaths: {
        Какой_тоТип: ['catalog63'],
        ВложенныйТип: ['catalog63', 'catalog64'],
      },
      categoryNames: { catalog63: 'Общие', catalog64: 'Документы' },
      entriesByOwner: new Map(),
    });
    const общие = tree.find((t) => t.label === 'Общие');
    expect(общие?.children.map((c) => c.label)).toEqual(['Документы', 'Какой_тоТип']);
  });

  it('подсчёт ownerCount снизу вверх корректен', () => {
    const tree = buildTree({
      ownerPaths: {
        A: ['c1', 'c2'],
        B: ['c1', 'c2'],
        C: ['c1', 'c3'],
      },
      categoryNames: { c1: 'C1', c2: 'C2', c3: 'C3' },
      entriesByOwner: new Map(),
    });
    expect(tree[0].label).toBe('C1');
    expect(tree[0].ownerCount).toBe(3); // 2 в C2 + 1 в C3
  });
});
