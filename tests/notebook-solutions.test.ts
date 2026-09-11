import { describe, expect, it } from 'vitest';
import {
  pushSolution,
  serializeSolution,
  solutionPath,
  solutionRawUrl,
  suggestSolutionName,
} from '../src/notebook/git-solutions';
import type { GitConfig } from '../src/app/git-config';
import type { NbSource } from '../src/notebook/nb-src';
import type { Notebook } from '../src/notebook/types';

const CFG: GitConfig = {
  owner: 'ivanov',
  repo: 'my-solutions',
  branch: 'main',
  path: '',
  token: 'ghp_test',
};

const SOURCE: NbSource = {
  owner: 'pedagog',
  repo: 'tasks-repo',
  branch: 'main',
  path: 'notebooks/lesson-01.nb.json',
};

describe('serializeSolution', () => {
  const NB: Notebook = {
    cells: [
      { id: 'a', type: 'markdown', source: '# Урок' },
      { id: 'b', type: 'code', source: 'x = 1;' },
      {
        id: 'c',
        type: 'task',
        source: 'Сообщить(42);',
        task: { statement: 'Выведи 42', starter: '', tests: [{ kind: 'stdout', expect: '42' }] },
        ref: 'tasks/x.task.yaml',
      },
    ],
  };

  it('добавляет корневой role и source', () => {
    const text = serializeSolution(NB, { repo: 'pedagog/tasks-repo', sha: 'abc', nb_path: 'notebooks/x.nb.json', branch: 'main' });
    const parsed = JSON.parse(text);
    expect(parsed.role).toBe('solution');
    expect(parsed.source.repo).toBe('pedagog/tasks-repo');
    expect(parsed.source.sha).toBe('abc');
  });

  it('task-cell содержит task_snapshot + ref + решение', () => {
    const text = serializeSolution(NB, { repo: 'r', sha: null, nb_path: 'p', branch: 'main' });
    const parsed = JSON.parse(text);
    const task = parsed.cells[2];
    expect(task.t).toBe('task');
    expect(task.s).toBe('Сообщить(42);');
    expect(task.ref).toBe('tasks/x.task.yaml');
    expect(task.task_snapshot.tests[0]).toEqual({ kind: 'stdout', expect: '42' });
  });

  it('explanation ученика (#33) попадает в решение', () => {
    const nb: Notebook = {
      cells: [{
        id: 'x', type: 'task', source: 'Сообщить(42);',
        task: { statement: 'y', starter: '', tests: [{ kind: 'stdout', expect: '42' }] },
        explanation: 'Я решил через прямой вывод 42.',
      }],
    };
    const parsed = JSON.parse(serializeSolution(nb, { repo: 'r', sha: null, nb_path: 'p', branch: 'main' }));
    expect(parsed.cells[0].explanation).toBe('Я решил через прямой вывод 42.');
  });

  it('sha=null остаётся null в JSON', () => {
    const text = serializeSolution({ cells: [] }, { repo: 'r', sha: null, nb_path: 'p', branch: 'main' });
    expect(JSON.parse(text).source.sha).toBeNull();
  });

  it('md- и code-ячейки без task_snapshot', () => {
    const text = serializeSolution(NB, { repo: 'r', sha: 's', nb_path: 'p', branch: 'main' });
    const parsed = JSON.parse(text);
    expect(parsed.cells[0].task_snapshot).toBeUndefined();
    expect(parsed.cells[1].task_snapshot).toBeUndefined();
  });

  it('query-ячейка сохраняет source/schema/data (раньше молча превращалась в code)', () => {
    const nb: Notebook = {
      cells: [{
        id: 'q', type: 'query',
        source: 'ВЫБРАТЬ Наименование ИЗ Справочник.Склады',
        schema: 'version: 1\ntables: []\n',
        data: 'version: 1\nrecords: {}\n',
        ref: 'datasets/mini-erp',
      }],
    };
    const parsed = JSON.parse(serializeSolution(nb, { repo: 'r', sha: null, nb_path: 'p', branch: 'main' }));
    expect(parsed.cells[0].t).toBe('query');
    expect(parsed.cells[0].s).toContain('ВЫБРАТЬ');
    expect(parsed.cells[0].schema).toContain('tables: []');
    expect(parsed.cells[0].data).toContain('records: {}');
    expect(parsed.cells[0].ref).toBe('datasets/mini-erp');
  });

  it('query-task-ячейка сохраняет спеку как query_task_snapshot', () => {
    const nb: Notebook = {
      cells: [{
        id: 'qt', type: 'query-task', source: 'ВЫБРАТЬ 1',
        task: {
          statement: 'Задача-запрос',
          starter: 'ВЫБРАТЬ ...',
          schema: 'version: 1\ntables: []\n',
          data: 'version: 1\nrecords: {}\n',
          expected: { kind: 'unordered', columns: ['x'], rows: [[1]] },
        },
        ref: 'datasets/q1',
      }],
    };
    const parsed = JSON.parse(serializeSolution(nb, { repo: 'r', sha: null, nb_path: 'p', branch: 'main' }));
    const cell = parsed.cells[0];
    expect(cell.t).toBe('query-task');
    expect(cell.s).toBe('ВЫБРАТЬ 1');
    expect(cell.ref).toBe('datasets/q1');
    expect(cell.query_task_snapshot?.expected?.columns).toEqual(['x']);
    // Живого `query_task` в снапшоте нет — только snapshot.
    expect(cell.query_task).toBeUndefined();
  });
});

describe('solutionPath / solutionRawUrl', () => {
  it('простой путь без вложенности из git-config', () => {
    expect(solutionPath(CFG, 'lesson-01')).toBe('solutions/lesson-01.nb.json');
  });
  it('учитывает path из GitConfig', () => {
    const cfg2 = { ...CFG, path: 'bsl' };
    expect(solutionPath(cfg2, 'lesson-01')).toBe('bsl/solutions/lesson-01.nb.json');
  });
  it('raw URL', () => {
    expect(solutionRawUrl(CFG, 'lesson-01')).toBe(
      'https://raw.githubusercontent.com/ivanov/my-solutions/main/solutions/lesson-01.nb.json',
    );
  });
});

describe('suggestSolutionName', () => {
  it('берёт basename без .nb.json', () => {
    expect(suggestSolutionName('notebooks/lesson-01-basics.nb.json')).toBe('lesson-01-basics');
  });
  it('без .nb.json — fallback', () => {
    const name = suggestSolutionName('weird-path');
    expect(name).toMatch(/^solution-\d+$/);
  });
});

describe('pushSolution', () => {
  it('PUT в solutions/<name>.nb.json, возвращает raw URL и SHA', async () => {
    let capturedBody: unknown = null;
    let capturedPath = '';
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (init?.method === 'PUT') {
        capturedPath = url;
        capturedBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ content: { sha: 'new-blob-sha' } }), { status: 201 });
      }
      return new Response('not mocked', { status: 404 });
    }) as typeof fetch;

    const nb: Notebook = { cells: [{ id: 'a', type: 'code', source: 'x' }] };
    const r = await pushSolution(CFG, 'lesson-01', nb, SOURCE, 'abc123', null, fetchFn);
    expect(r.path).toBe('solutions/lesson-01.nb.json');
    expect(r.rawUrl).toBe(
      'https://raw.githubusercontent.com/ivanov/my-solutions/main/solutions/lesson-01.nb.json',
    );
    expect(r.sha).toBe('new-blob-sha');
    expect(capturedPath).toContain('/repos/ivanov/my-solutions/contents/solutions/lesson-01.nb.json');
    const body = capturedBody as Record<string, unknown>;
    // Commit message включает SHA педагога
    expect(body.message).toContain('abc123'.slice(0, 7));
  });

  it('обновление (prevSha задан) — commit message «обновление»', async () => {
    let capturedBody: unknown = null;
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        capturedBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ content: { sha: 's' } }), { status: 200 });
      }
      return new Response('not mocked', { status: 404 });
    }) as typeof fetch;
    const nb: Notebook = { cells: [] };
    await pushSolution(CFG, 'x', nb, SOURCE, null, 'old-sha', fetchFn);
    const body = capturedBody as Record<string, unknown>;
    expect(body.sha).toBe('old-sha');
    expect(body.message).toMatch(/обновл/i);
  });
});
