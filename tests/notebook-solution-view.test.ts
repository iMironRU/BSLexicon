import { describe, expect, it } from 'vitest';
import { parseAnyFile } from '../src/notebook/git-notebooks';
import { fetchNotebookFromSrc } from '../src/notebook/nb-src';

const SOLUTION_FILE = JSON.stringify({
  v: 1,
  role: 'solution',
  source: {
    repo: 'pedagog/tasks-repo',
    sha: 'abc1234def',
    nb_path: 'notebooks/lesson-01.nb.json',
    branch: 'main',
  },
  cells: [
    { t: 'md', s: '# Урок 1' },
    { t: 'code', s: 'Х = 5;' },
    {
      t: 'task',
      s: 'Сообщить(42);',
      ref: 'tasks/print-42.task.yaml',
      task_snapshot: {
        statement: '## Выведи 42',
        starter: '// ...',
        tests: [{ kind: 'stdout', expect: '42' }],
      },
    },
  ],
});

const LESSON_FILE = JSON.stringify({
  v: 1,
  cells: [
    { t: 'md', s: '# Урок' },
    { t: 'task', s: '', task: { statement: 'X', starter: '', tests: [{ kind: 'stdout', expect: 'a' }] } },
  ],
});

describe('parseAnyFile — детект kind', () => {
  it('файл-решение → kind: solution + solutionMeta', () => {
    const r = parseAnyFile(SOLUTION_FILE);
    expect(r.kind).toBe('solution');
    if (r.kind === 'solution') {
      expect(r.solutionMeta.repo).toBe('pedagog/tasks-repo');
      expect(r.solutionMeta.sha).toBe('abc1234def');
      expect(r.solutionMeta.nb_path).toBe('notebooks/lesson-01.nb.json');
    }
  });

  it('в task-cell решения spec берётся из task_snapshot', () => {
    const r = parseAnyFile(SOLUTION_FILE);
    const task = r.notebook.cells[2];
    if (task.type === 'task') {
      expect(task.source).toBe('Сообщить(42);');
      expect(task.ref).toBe('tasks/print-42.task.yaml');
      expect(task.task.tests[0]).toEqual({ kind: 'stdout', expect: '42' });
    }
  });

  it('обычный урок → kind: lesson (без solutionMeta)', () => {
    const r = parseAnyFile(LESSON_FILE);
    expect(r.kind).toBe('lesson');
  });
});

describe('fetchNotebookFromSrc с role=solution', () => {
  it('НЕ резолвит ref (spec из snapshot достаточно), возвращает solutionMeta', async () => {
    const NB_URL = 'https://raw.githubusercontent.com/ivanov/solutions/main/solutions/x.nb.json';
    // Замечу что TASK_URL мы НЕ мокируем — если бы код пытался резолвить, свалилось бы в warning.
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === NB_URL) return new Response(SOLUTION_FILE, { status: 200 });
      // API_BRANCH (SHA) — не важен для solution, но чтобы не тормозить тест — 404.
      return new Response('not mocked', { status: 404 });
    }) as typeof fetch;

    const r = await fetchNotebookFromSrc(NB_URL, fetchFn);
    expect(r.kind).toBe('solution');
    expect(r.solutionMeta).toBeDefined();
    expect(r.solutionMeta?.repo).toBe('pedagog/tasks-repo');
    expect(r.refWarnings).toEqual([]);
    // task содержит spec из snapshot
    const task = r.notebook.cells[2];
    if (task.type === 'task') {
      expect(task.task.tests[0]).toMatchObject({ expect: '42' });
    }
  });

  it('lesson-файл через тот же путь → kind: lesson, ref резолвится', async () => {
    const NB_URL = 'https://raw.githubusercontent.com/u/r/main/x.nb.json';
    const fetchFn = mockFetchLesson(NB_URL);
    const r = await fetchNotebookFromSrc(NB_URL, fetchFn);
    expect(r.kind).toBe('lesson');
    expect(r.solutionMeta).toBeUndefined();
  });
});

function mockFetchLesson(nbUrl: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === nbUrl) return new Response(LESSON_FILE, { status: 200 });
    return new Response('not mocked', { status: 404 });
  }) as typeof fetch;
}
