import { describe, expect, it } from 'vitest';
import { decodeNotebook, encodeNotebook, newCell, starterNotebook } from '../src/notebook/serialize';
import type { Notebook } from '../src/notebook/types';

describe('notebook serialize', () => {
  it('round-trip: encode → decode возвращает те же ячейки', async () => {
    const nb: Notebook = {
      cells: [
        newCell('markdown', '# Заголовок\n\nАбзац.'),
        newCell('code', 'Сообщить("а");'),
        newCell('code', 'Х = 5;\nСообщить(Х);'),
      ],
    };
    const encoded = await encodeNotebook(nb);
    const decoded = await decodeNotebook(encoded);
    expect(decoded.cells).toHaveLength(3);
    expect(decoded.cells.map((c) => c.type)).toEqual(['markdown', 'code', 'code']);
    expect(decoded.cells.map((c) => c.source)).toEqual(nb.cells.map((c) => c.source));
  });

  it('id при decode генерируется новый (не полагаемся на URL)', async () => {
    const nb: Notebook = { cells: [newCell('code', 'Сообщить(1);')] };
    const originalId = nb.cells[0].id;
    const decoded = await decodeNotebook(await encodeNotebook(nb));
    expect(decoded.cells[0].id).not.toBe(originalId);
    expect(decoded.cells[0].id).toMatch(/^c\d+$/);
  });

  it('encoded URL безопасен для параметра (только url-safe base64 символы)', async () => {
    const nb: Notebook = { cells: [newCell('code', 'x = "тест & <html>";')] };
    const encoded = await encodeNotebook(nb);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('пустой notebook кодируется без ошибок', async () => {
    const nb: Notebook = { cells: [] };
    const decoded = await decodeNotebook(await encodeNotebook(nb));
    expect(decoded.cells).toEqual([]);
  });

  it('крупный notebook (10 ячеек по 200 символов) сжимается заметно', async () => {
    const cells = Array.from({ length: 10 }, (_, i) =>
      newCell('code', `Сообщить("строка ${i}");\n`.repeat(20)),
    );
    const nb: Notebook = { cells };
    const encoded = await encodeNotebook(nb);
    const rawSize = JSON.stringify(nb).length;
    // gzip должен ужать хотя бы вдвое на повторяющемся контенте
    expect(encoded.length).toBeLessThan(rawSize / 2);
  });

  it('старт-notebook — демо-урок со всеми четырьмя типами (#26 + #42)', () => {
    const nb = starterNotebook();
    expect(nb.cells.length).toBeGreaterThanOrEqual(5);
    const types = new Set(nb.cells.map((c) => c.type));
    expect(types.has('markdown')).toBe(true);
    expect(types.has('code')).toBe(true);
    expect(types.has('task')).toBe(true);
    expect(types.has('query')).toBe(true);
    // Первая ячейка — заголовок, задаёт контекст урока.
    expect(nb.cells[0].type).toBe('markdown');
  });

  it('query-ячейка: round-trip сохраняет source/schema/data и ref', async () => {
    const initial = newCell('query', {
      source: 'ВЫБРАТЬ 1',
      schema: 'version: 1\ntables: []\n',
      data: 'version: 1\nrecords: {}\n',
      ref: 'datasets/mini-erp',
    });
    const nb: Notebook = { cells: [initial] };
    const decoded = await decodeNotebook(await encodeNotebook(nb));
    const cell = decoded.cells[0];
    expect(cell.type).toBe('query');
    if (cell.type !== 'query') return;
    expect(cell.source).toBe('ВЫБРАТЬ 1');
    expect(cell.schema).toContain('tables: []');
    expect(cell.data).toContain('records: {}');
    expect(cell.ref).toBe('datasets/mini-erp');
  });

  it('newCell("query") без init — вкладывает mini-erp по умолчанию', () => {
    const c = newCell('query');
    expect(c.type).toBe('query');
    if (c.type !== 'query') return;
    // Дефолтная схема из examples/query-demo — там есть Номенклатура.
    expect(c.schema).toContain('Номенклатура');
    expect(c.data).toContain('Молоток');
    // Дефолтный запрос — «Номенклатура ГДЕ ПометкаУдаления = ЛОЖЬ».
    expect(c.source).toMatch(/ВЫБРАТЬ/);
    expect(c.ref).toBeUndefined();
  });

  it('битый base64 → decode бросает', async () => {
    await expect(decodeNotebook('###НЕ_BASE64###')).rejects.toThrow();
  });

  it('неверная схема (v: 2) → decode бросает', async () => {
    // Соберём вручную gzip с v:2
    const bad = JSON.stringify({ v: 2, cells: [] });
    const bytes = new TextEncoder().encode(bad);
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    const chunks: Uint8Array[] = [];
    const r = cs.readable.getReader();
    for (;;) { const { done, value } = await r.read(); if (done) break; if (value) chunks.push(value); }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    let bin = ''; for (const b of merged) bin += String.fromCharCode(b);
    const encoded = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await expect(decodeNotebook(encoded)).rejects.toThrow(/schema/i);
  });
});
