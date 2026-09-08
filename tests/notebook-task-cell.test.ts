import { describe, expect, it } from 'vitest';
import { decodeNotebook, encodeNotebook, newCell } from '../src/notebook/serialize';
import type { Notebook, TaskSpec } from '../src/notebook/types';
import { runTask } from '../src/judge/runner';
import type { Task } from '../src/judge/types';

/**
 * Тесты task-ячейки: сериализация и то, что runner Judge корректно
 * работает на «встроенной» задаче (без книжной идентичности).
 */

const SIMPLE_TASK: TaskSpec = {
  statement: 'Выведи "привет"',
  starter: '',
  tests: [{ kind: 'stdout', expect: 'привет' }],
};

const CALL_TASK: TaskSpec = {
  statement: 'Функция Удвоить(х)',
  starter: '',
  tests: [{ kind: 'call', invoke: 'Удвоить(5)', expect: '10' }],
};

function toRuntimeTask(spec: TaskSpec): Task {
  return {
    id: 'inline',
    title: 'test',
    chapter: '',
    statement: spec.statement,
    starter: spec.starter,
    tests: spec.tests,
    hints: spec.hints,
  };
}

describe('notebook task-cell serialize', () => {
  it('task-ячейка round-trips (условие, tests, starter)', async () => {
    const nb: Notebook = { cells: [newCell('task', 'Сообщить("привет");', SIMPLE_TASK)] };
    const encoded = await encodeNotebook(nb);
    const decoded = await decodeNotebook(encoded);
    expect(decoded.cells).toHaveLength(1);
    const c = decoded.cells[0];
    expect(c.type).toBe('task');
    if (c.type === 'task') {
      expect(c.source).toBe('Сообщить("привет");');
      expect(c.task.statement).toBe('Выведи "привет"');
      expect(c.task.tests).toHaveLength(1);
      expect(c.task.tests[0].kind).toBe('stdout');
    }
  });

  it('смешанный notebook (md + code + task) сохраняет все три типа', async () => {
    const nb: Notebook = {
      cells: [
        newCell('markdown', '# Урок'),
        newCell('code', 'Х = 1;'),
        newCell('task', '', SIMPLE_TASK),
      ],
    };
    const decoded = await decodeNotebook(await encodeNotebook(nb));
    expect(decoded.cells.map((c) => c.type)).toEqual(['markdown', 'code', 'task']);
  });

  it('task-ячейка с ref (#28) round-trips вместе с inline task', async () => {
    const cell = newCell('task', 'Решение;', SIMPLE_TASK);
    if (cell.type === 'task') cell.ref = 'tasks/strings-length.task.yaml';
    const nb: Notebook = { cells: [cell] };
    const decoded = await decodeNotebook(await encodeNotebook(nb));
    const c = decoded.cells[0];
    expect(c.type).toBe('task');
    if (c.type === 'task') {
      expect(c.ref).toBe('tasks/strings-length.task.yaml');
      // inline остаётся как fallback / snapshot
      expect(c.task.tests).toHaveLength(1);
    }
  });

  it('task-ячейка с explanation (#33) round-trips в ?nb=', async () => {
    const cell = newCell('task', 'Решение;', SIMPLE_TASK);
    if (cell.type === 'task') cell.explanation = 'Я думал так: перебираю каждый элемент.';
    const nb: Notebook = { cells: [cell] };
    const decoded = await decodeNotebook(await encodeNotebook(nb));
    const c = decoded.cells[0];
    if (c.type === 'task') {
      expect(c.explanation).toBe('Я думал так: перебираю каждый элемент.');
    }
  });

  it('task-ячейка без ref — поле остаётся undefined после round-trip', async () => {
    const nb: Notebook = { cells: [newCell('task', 'x', SIMPLE_TASK)] };
    const decoded = await decodeNotebook(await encodeNotebook(nb));
    const c = decoded.cells[0];
    if (c.type === 'task') expect(c.ref).toBeUndefined();
  });

  it('старый URL без task-полей (backward-compat) — открывается', async () => {
    // Собираем старый payload v:1 c cells: [{t:'md',s:'x'}, {t:'code',s:'y'}]
    const bad = JSON.stringify({ v: 1, cells: [{ t: 'md', s: 'старая' }, { t: 'code', s: 'Х = 5;' }] });
    const bytes = new TextEncoder().encode(bad);
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    const chunks: Uint8Array[] = [];
    const r = cs.readable.getReader();
    for (;;) { const { done, value } = await r.read(); if (done) break; if (value) chunks.push(value); }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const m = new Uint8Array(total); let off = 0;
    for (const c of chunks) { m.set(c, off); off += c.length; }
    let bin = ''; for (const b of m) bin += String.fromCharCode(b);
    const encoded = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const decoded = await decodeNotebook(encoded);
    expect(decoded.cells).toHaveLength(2);
    expect(decoded.cells[0].type).toBe('markdown');
    expect(decoded.cells[1].type).toBe('code');
  });
});

describe('notebook task-cell runner', () => {
  it('stdout-тест pass: правильное решение', () => {
    const r = runTask(toRuntimeTask(SIMPLE_TASK), 'Сообщить("привет");');
    expect(r.overall).toBe('pass');
    expect(r.tests[0].status).toBe('pass');
  });

  it('stdout-тест fail: неверный вывод', () => {
    const r = runTask(toRuntimeTask(SIMPLE_TASK), 'Сообщить("нет");');
    expect(r.overall).toBe('fail');
    expect(r.tests[0].status).toBe('fail');
    expect(r.tests[0].actual).toBe('нет');
    expect(r.tests[0].expected).toBe('привет');
  });

  it('stdout-тест error: runtime-ошибка в решении', () => {
    const r = runTask(toRuntimeTask(SIMPLE_TASK), 'НеСуществует();');
    expect(r.overall).toBe('error');
    expect(r.tests[0].status).toBe('error');
    expect(r.tests[0].error).toBeTruthy();
  });

  it('call-тест pass: функция возвращает правильное значение', () => {
    const r = runTask(
      toRuntimeTask(CALL_TASK),
      'Функция Удвоить(х) Возврат х * 2; КонецФункции',
    );
    expect(r.overall).toBe('pass');
  });

  it('call-тест fail: функция считает не так', () => {
    const r = runTask(
      toRuntimeTask(CALL_TASK),
      'Функция Удвоить(х) Возврат х + 1; КонецФункции',
    );
    expect(r.overall).toBe('fail');
  });
});
