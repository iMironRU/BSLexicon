import { describe, expect, it } from 'vitest';
import {
  listNotebooks,
  loadNotebook,
  saveNotebook,
  serializeNotebook,
  parseStoredNotebook,
  validateNotebookName,
} from '../src/notebook/git-notebooks';
import type { GitConfig } from '../src/app/git-config';
import type { Notebook } from '../src/notebook/types';

const CFG: GitConfig = {
  owner: 'ivanov',
  repo: 'lessons',
  branch: 'main',
  path: '',
  token: 'ghp_test',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Простой mock: карта url → response. */
function mockFetch(map: Record<string, Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    // Обрежем query для совпадения
    const [base] = url.split('?');
    if (map[base]) return map[base].clone();
    if (map[url]) return map[url].clone();
    return new Response('not mocked: ' + url, { status: 404 });
  }) as typeof fetch;
}

describe('serialize / parse .nb.json', () => {
  it('round-trip трёх типов ячеек с ref', () => {
    const nb: Notebook = {
      cells: [
        { id: 'a', type: 'markdown', source: '# Урок' },
        { id: 'b', type: 'code', source: 'Х = 5;' },
        {
          id: 'c', type: 'task', source: '// решение',
          task: { statement: 'x', starter: '', tests: [{ kind: 'stdout', expect: 'y' }] },
          ref: 'tasks/x.task.yaml',
        },
      ],
    };
    const parsed = parseStoredNotebook(serializeNotebook(nb));
    expect(parsed.cells).toHaveLength(3);
    expect(parsed.cells.map((c) => c.type)).toEqual(['markdown', 'code', 'task']);
    const task = parsed.cells[2];
    if (task.type === 'task') {
      expect(task.ref).toBe('tasks/x.task.yaml');
      expect(task.task.tests[0].kind).toBe('stdout');
    }
  });

  it('serialize даёт pretty JSON — human diff-friendly', () => {
    const nb: Notebook = { cells: [{ id: 'a', type: 'code', source: 'x' }] };
    const text = serializeNotebook(nb);
    expect(text).toContain('\n');
    expect(text).toContain('  ');
  });

  it('битый JSON — parseStoredNotebook бросает', () => {
    expect(() => parseStoredNotebook('{{not json')).toThrow();
  });

  it('неверная схема v: 2 — бросает', () => {
    expect(() => parseStoredNotebook('{"v": 2, "cells": []}')).toThrow(/схема/i);
  });
});

describe('validateNotebookName', () => {
  it('пустое → ошибка', () => {
    expect(validateNotebookName('')).toMatch(/введи/i);
  });
  it('латиница + дефис ок', () => {
    expect(validateNotebookName('lesson-01-intro')).toBeNull();
  });
  it('кириллица → ошибка (для FS-универсальности)', () => {
    expect(validateNotebookName('урок')).toMatch(/латиница/i);
  });
  it('пробелы → ошибка', () => {
    expect(validateNotebookName('lesson 01')).toMatch(/латиница/i);
  });
  it('слишком длинное', () => {
    expect(validateNotebookName('a'.repeat(81))).toMatch(/длинное/i);
  });
  it('начинается с точки → ошибка', () => {
    expect(validateNotebookName('.hidden')).toMatch(/начинать/i);
  });
});

describe('listNotebooks', () => {
  it('пустая директория (404) → пустой массив', async () => {
    const fetchFn = mockFetch({
      'https://api.github.com/repos/ivanov/lessons/contents/notebooks': new Response(null, { status: 404 }),
    });
    const files = await listNotebooks(CFG, fetchFn);
    expect(files).toEqual([]);
  });

  it('фильтрует по расширению .nb.json и сортирует по имени', async () => {
    const fetchFn = mockFetch({
      'https://api.github.com/repos/ivanov/lessons/contents/notebooks': jsonResponse(200, [
        { name: 'lesson-02.nb.json', path: 'notebooks/lesson-02.nb.json', type: 'file', sha: 's2', size: 42 },
        { name: 'lesson-01.nb.json', path: 'notebooks/lesson-01.nb.json', type: 'file', sha: 's1', size: 30 },
        { name: 'README.md', path: 'notebooks/README.md', type: 'file', sha: 'sr' },
        { name: 'sub', path: 'notebooks/sub', type: 'dir', sha: 'sd' },
      ]),
    });
    const files = await listNotebooks(CFG, fetchFn);
    expect(files.map((f) => f.name)).toEqual(['lesson-01', 'lesson-02']);
    expect(files[0].sha).toBe('s1');
  });

  it('учитывает path из GitConfig', async () => {
    const cfg2: GitConfig = { ...CFG, path: 'bslexicon' };
    const fetchFn = mockFetch({
      'https://api.github.com/repos/ivanov/lessons/contents/bslexicon/notebooks': jsonResponse(200, [
        { name: 'x.nb.json', path: 'bslexicon/notebooks/x.nb.json', type: 'file', sha: 'sx' },
      ]),
    });
    const files = await listNotebooks(cfg2, fetchFn);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('bslexicon/notebooks/x.nb.json');
  });
});

describe('loadNotebook', () => {
  it('успешно грузит существующий', async () => {
    const nb: Notebook = { cells: [{ id: 'x', type: 'code', source: 'Х = 1;' }] };
    const content = Buffer.from(serializeNotebook(nb), 'utf8').toString('base64');
    const fetchFn = mockFetch({
      'https://api.github.com/repos/ivanov/lessons/contents/notebooks/lesson-01.nb.json': jsonResponse(200, {
        content, encoding: 'base64', sha: 'blob-sha-1', name: 'lesson-01.nb.json', path: 'notebooks/lesson-01.nb.json',
      }),
    });
    const r = await loadNotebook(CFG, 'lesson-01', fetchFn);
    expect(r).not.toBeNull();
    expect(r!.sha).toBe('blob-sha-1');
    expect(r!.notebook.cells).toHaveLength(1);
    expect(r!.notebook.cells[0].source).toBe('Х = 1;');
  });

  it('404 → null (файл удалён между list и load)', async () => {
    const fetchFn = mockFetch({});
    const r = await loadNotebook(CFG, 'ghost', fetchFn);
    expect(r).toBeNull();
  });
});

describe('saveNotebook', () => {
  it('новый файл (prevSha null) — PUT без sha, возвращает новый sha', async () => {
    let requestBody: unknown = null;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (init?.method === 'PUT' && url.endsWith('/notebooks/lesson-x.nb.json')) {
        requestBody = JSON.parse(String(init.body));
        return jsonResponse(201, { content: { sha: 'new-sha' } });
      }
      return new Response('not mocked', { status: 404 });
    }) as typeof fetch;
    const nb: Notebook = { cells: [{ id: 'a', type: 'code', source: 'x' }] };
    const r = await saveNotebook(CFG, 'lesson-x', nb, null, fetchFn);
    expect(r.sha).toBe('new-sha');
    expect(r.path).toBe('notebooks/lesson-x.nb.json');
    const body = requestBody as Record<string, unknown>;
    expect(body.message).toMatch(/новый/i);
    expect(body.sha).toBeUndefined(); // PUT без sha для нового файла
  });

  it('обновление (prevSha задан) — PUT содержит sha', async () => {
    let requestBody: unknown = null;
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        requestBody = JSON.parse(String(init.body));
        return jsonResponse(200, { content: { sha: 'updated-sha' } });
      }
      return new Response('not mocked', { status: 404 });
    }) as typeof fetch;
    const nb: Notebook = { cells: [] };
    const r = await saveNotebook(CFG, 'x', nb, 'old-sha', fetchFn);
    expect(r.sha).toBe('updated-sha');
    const body = requestBody as Record<string, unknown>;
    expect(body.sha).toBe('old-sha');
    expect(body.message).toMatch(/обновл/i);
  });
});
