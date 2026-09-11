import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/app/markdown';

/**
 * Проверяем не HTML-строку (её у нас нет — только React-элементы), а
 * структуру дерева. Тесты защищают от регрессий: если наш мини-парсер
 * съест что-то в inline или пропустит блок — сразу увидим.
 */

interface E { type?: string; props?: { children?: unknown } }
function shape(node: unknown): unknown {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(shape);
  const e = node as E;
  if (e && typeof e === 'object' && 'type' in e) {
    return { type: e.type, children: shape(e.props?.children) };
  }
  return null;
}

describe('renderMarkdown', () => {
  it('заголовок # → h1', () => {
    const r = shape(renderMarkdown('# Тема'));
    expect(r).toEqual([{ type: 'h1', children: ['Тема'] }]);
  });

  it('заголовки ## и ###', () => {
    const r = shape(renderMarkdown('## Раздел\n\n### Пункт'));
    expect(r).toEqual([
      { type: 'h2', children: ['Раздел'] },
      { type: 'h3', children: ['Пункт'] },
    ]);
  });

  it('параграф с inline-code и bold', () => {
    const r = shape(renderMarkdown('Функция `Сообщить` **важна**'));
    expect(r).toEqual([{
      type: 'p',
      children: [
        'Функция ',
        { type: 'code', children: 'Сообщить' },
        ' ',
        { type: 'b', children: 'важна' },
      ],
    }]);
  });

  it('список с - создаёт ul', () => {
    const r = shape(renderMarkdown('- один\n- два\n- три'));
    expect(r).toEqual([{
      type: 'ul',
      children: [
        { type: 'li', children: ['один'] },
        { type: 'li', children: ['два'] },
        { type: 'li', children: ['три'] },
      ],
    }]);
  });

  it('нумерованный список создаёт ol', () => {
    const r = shape(renderMarkdown('1. первый\n2. второй'));
    expect(r).toEqual([{
      type: 'ol',
      children: [
        { type: 'li', children: ['первый'] },
        { type: 'li', children: ['второй'] },
      ],
    }]);
  });

  it('fenced code ``` → pre>code с классом языка', () => {
    const r = shape(renderMarkdown('```bsl\nСообщить(1);\n```'));
    expect(r).toEqual([{
      type: 'pre',
      children: { type: 'code', children: 'Сообщить(1);' },
    }]);
  });

  it('смешанный документ: заголовок + параграф + список + код', () => {
    const src = '# Введение\n\nЭто *курс*.\n\n- шаг\n- ещё шаг\n\n```bsl\nX = 1;\n```';
    const r = renderMarkdown(src);
    expect(Array.isArray(r) ? r.length : 0).toBe(4);
  });

  it('никакого XSS — HTML в тексте остаётся текстом', () => {
    const r = shape(renderMarkdown('<script>alert(1)</script>'));
    expect(r).toEqual([{ type: 'p', children: ['<script>alert(1)</script>'] }]);
  });
});
