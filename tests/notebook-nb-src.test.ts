import { describe, expect, it } from 'vitest';
import {
  fetchNotebookFromSrc,
  parseNbSrcUrl,
  resolveRefUrl,
} from '../src/notebook/nb-src';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}
function textResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

function mockFetch(map: Record<string, Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (map[url]) return map[url].clone();
    return new Response(`not mocked: ${url}`, { status: 404 });
  }) as typeof fetch;
}

describe('parseNbSrcUrl', () => {
  it('raw.githubusercontent.com/...', () => {
    const r = parseNbSrcUrl(
      'https://raw.githubusercontent.com/ivanov/tasks/main/notebooks/lesson-01.nb.json',
    );
    expect(r).toEqual({
      owner: 'ivanov',
      repo: 'tasks',
      branch: 'main',
      path: 'notebooks/lesson-01.nb.json',
    });
  });

  it('github.com/user/repo/blob/branch/path', () => {
    const r = parseNbSrcUrl(
      'https://github.com/ivanov/tasks/blob/main/notebooks/lesson-01.nb.json',
    );
    expect(r).toEqual({
      owner: 'ivanov',
      repo: 'tasks',
      branch: 'main',
      path: 'notebooks/lesson-01.nb.json',
    });
  });

  it('github.com/user/repo/raw/branch/path', () => {
    const r = parseNbSrcUrl('https://github.com/x/y/raw/dev/notebooks/x.nb.json');
    expect(r?.branch).toBe('dev');
  });

  it('nested paths работают', () => {
    const r = parseNbSrcUrl(
      'https://raw.githubusercontent.com/u/r/main/nested/dir/deep/file.nb.json',
    );
    expect(r?.path).toBe('nested/dir/deep/file.nb.json');
  });

  it('не github → null', () => {
    expect(parseNbSrcUrl('https://gitlab.com/u/r/-/raw/main/x.json')).toBeNull();
  });

  it('битый URL → null', () => {
    expect(parseNbSrcUrl('не url вообще')).toBeNull();
  });

  it('слишком короткий путь → null', () => {
    expect(parseNbSrcUrl('https://raw.githubusercontent.com/user/repo')).toBeNull();
  });

  it('github.com без blob/raw → null', () => {
    expect(parseNbSrcUrl('https://github.com/u/r/tree/main/dir')).toBeNull();
  });
});

describe('resolveRefUrl', () => {
  it('строит raw URL относительно корня репо', () => {
    const src = { owner: 'ivanov', repo: 'tasks', branch: 'main', path: 'notebooks/x.nb.json' };
    expect(resolveRefUrl(src, 'tasks/strings-01.task.yaml')).toBe(
      'https://raw.githubusercontent.com/ivanov/tasks/main/tasks/strings-01.task.yaml',
    );
  });
});

describe('fetchNotebookFromSrc', () => {
  const NB_URL = 'https://raw.githubusercontent.com/ivanov/tasks/main/notebooks/lesson.nb.json';
  const TASK_URL = 'https://raw.githubusercontent.com/ivanov/tasks/main/tasks/x.task.yaml';
  const API_BRANCH = 'https://api.github.com/repos/ivanov/tasks/branches/main';

  const nbBody = JSON.stringify({
    v: 1,
    cells: [
      { t: 'md', s: '# Урок' },
      { t: 'task', s: '', task: { statement: 'placeholder', starter: '', tests: [{ kind: 'stdout', expect: '' }] }, ref: 'tasks/x.task.yaml' },
    ],
  });
  const taskYaml = `
statement: |
  Выведи 42
starter: ""
tests:
  - kind: stdout
    expect: "42"
`;

  it('успешный сценарий: nb + ref + SHA', async () => {
    const fetchFn = mockFetch({
      [NB_URL]: textResponse(200, nbBody),
      [TASK_URL]: textResponse(200, taskYaml),
      [API_BRANCH]: jsonResponse(200, { commit: { sha: 'abc123def' } }),
    });
    const r = await fetchNotebookFromSrc(NB_URL, fetchFn);
    expect(r.source.owner).toBe('ivanov');
    expect(r.source.repo).toBe('tasks');
    expect(r.sha).toBe('abc123def');
    expect(r.refWarnings).toEqual([]);
    expect(r.notebook.cells).toHaveLength(2);
    const task = r.notebook.cells[1];
    expect(task.type).toBe('task');
    if (task.type === 'task') {
      // ref СОХРАНЁН (нужен при отправке решения #31), spec — из подгруженного YAML
      expect(task.ref).toBe('tasks/x.task.yaml');
      expect(task.task.tests[0]).toMatchObject({ kind: 'stdout', expect: '42' });
    }
  });

  it('битый URL → бросает с понятной ошибкой', async () => {
    await expect(fetchNotebookFromSrc('gitlab.com/x', mockFetch({}))).rejects.toThrow(/ссылка/i);
  });

  it('404 на nb → ошибка', async () => {
    const fetchFn = mockFetch({});
    await expect(fetchNotebookFromSrc(NB_URL, fetchFn)).rejects.toThrow(/не найден/i);
  });

  it('битый JSON в nb → ошибка о битом файле', async () => {
    const fetchFn = mockFetch({
      [NB_URL]: textResponse(200, '{{ битый'),
    });
    await expect(fetchNotebookFromSrc(NB_URL, fetchFn)).rejects.toThrow(/битый/i);
  });

  it('404 на ref → warning, ноутбук всё равно открывается', async () => {
    const fetchFn = mockFetch({
      [NB_URL]: textResponse(200, nbBody),
      // TASK_URL не мокан — вернёт 404
      [API_BRANCH]: jsonResponse(200, { commit: { sha: 'abc' } }),
    });
    const r = await fetchNotebookFromSrc(NB_URL, fetchFn);
    expect(r.refWarnings).toHaveLength(1);
    expect(r.refWarnings[0]).toMatch(/tasks\/x\.task\.yaml/);
    // task-cell остался с ref (spec из inline fallback)
    const task = r.notebook.cells[1];
    if (task.type === 'task') expect(task.ref).toBe('tasks/x.task.yaml');
  });

  it('невалидный YAML в ref → warning, не крашится', async () => {
    const fetchFn = mockFetch({
      [NB_URL]: textResponse(200, nbBody),
      [TASK_URL]: textResponse(200, ':: не yaml ::'),
      [API_BRANCH]: jsonResponse(200, { commit: { sha: 'abc' } }),
    });
    const r = await fetchNotebookFromSrc(NB_URL, fetchFn);
    expect(r.refWarnings.length).toBe(1);
  });

  it('SHA fetch fail → sha = null, но остальное работает', async () => {
    const fetchFn = mockFetch({
      [NB_URL]: textResponse(200, nbBody),
      [TASK_URL]: textResponse(200, taskYaml),
      // API_BRANCH не мокан — 404
    });
    const r = await fetchNotebookFromSrc(NB_URL, fetchFn);
    expect(r.sha).toBeNull();
    expect(r.notebook.cells).toHaveLength(2);
    expect(r.refWarnings).toEqual([]);
  });
});
