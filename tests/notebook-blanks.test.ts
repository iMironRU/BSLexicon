import { describe, expect, it } from 'vitest';
import {
  parseEditableRegions,
  hasBlanks,
  isLineEditable,
  isSelectionEditable,
} from '../src/notebook/blanks';

describe('parseEditableRegions', () => {
  it('без маркеров — пустой массив', () => {
    expect(parseEditableRegions('Функция X() Возврат 1; КонецФункции')).toEqual([]);
  });

  it('одна пара маркеров — один регион', () => {
    const src = [
      'Функция Удвоить(х)',   // 1
      '    //<<',              // 2 open
      '    // TODO',           // 3 editable
      '    //>>',              // 4 close
      'КонецФункции',          // 5
    ].join('\n');
    expect(parseEditableRegions(src)).toEqual([{ startLine: 3, endLine: 3 }]);
  });

  it('несколько editable-строк между маркерами', () => {
    const src = [
      'A',      // 1
      '//<<',   // 2
      'B',      // 3
      'C',      // 4
      'D',      // 5
      '//>>',   // 6
      'E',      // 7
    ].join('\n');
    expect(parseEditableRegions(src)).toEqual([{ startLine: 3, endLine: 5 }]);
  });

  it('несколько независимых регионов', () => {
    const src = [
      '//<<', 'a', '//>>',
      'x',
      '//<<', 'b', 'c', '//>>',
    ].join('\n');
    expect(parseEditableRegions(src)).toEqual([
      { startLine: 2, endLine: 2 },
      { startLine: 6, endLine: 7 },
    ]);
  });

  it('пустой регион (маркеры подряд) — игнорируется', () => {
    const src = ['A', '//<<', '//>>', 'B'].join('\n');
    expect(parseEditableRegions(src)).toEqual([]);
  });

  it('незакрытый регион — игнорируется', () => {
    const src = ['//<<', 'x', 'y'].join('\n');
    expect(parseEditableRegions(src)).toEqual([]);
  });

  it('вложенный open (два //<< без //>> между) — берём второй как start', () => {
    const src = ['//<<', 'a', '//<<', 'b', '//>>'].join('\n');
    expect(parseEditableRegions(src)).toEqual([{ startLine: 4, endLine: 4 }]);
  });

  it('маркеры с ведущими пробелами и inline-текстом после — распознаём', () => {
    const src = ['    //<< сюда', 'X', '  //>> и всё'].join('\n');
    expect(parseEditableRegions(src)).toEqual([{ startLine: 2, endLine: 2 }]);
  });
});

describe('hasBlanks', () => {
  it('нет маркеров — false', () => {
    expect(hasBlanks('X = 1')).toBe(false);
  });
  it('есть //<< — true', () => {
    expect(hasBlanks('a\n//<<\nx\n//>>\nb')).toBe(true);
  });
});

describe('isLineEditable / isSelectionEditable', () => {
  const regions = [{ startLine: 3, endLine: 5 }];

  it('без регионов — всё editable', () => {
    expect(isLineEditable(1, [])).toBe(true);
    expect(isSelectionEditable(1, 10, [])).toBe(true);
  });

  it('строка внутри региона — editable', () => {
    expect(isLineEditable(3, regions)).toBe(true);
    expect(isLineEditable(4, regions)).toBe(true);
    expect(isLineEditable(5, regions)).toBe(true);
  });

  it('строка вне региона — не editable', () => {
    expect(isLineEditable(1, regions)).toBe(false);
    expect(isLineEditable(2, regions)).toBe(false); // marker-строка
    expect(isLineEditable(6, regions)).toBe(false);
  });

  it('выделение всё внутри региона — editable', () => {
    expect(isSelectionEditable(3, 5, regions)).toBe(true);
  });

  it('выделение частично вне региона — не editable', () => {
    expect(isSelectionEditable(2, 4, regions)).toBe(false);
    expect(isSelectionEditable(4, 6, regions)).toBe(false);
  });
});
