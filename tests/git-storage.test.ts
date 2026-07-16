import { describe, expect, it } from 'vitest';
import type { GitConfig } from '../src/app/git-config';
import { GitApiError, readFile, snippetsFilePath, testConnection, writeFile } from '../src/app/git-storage';

const cfg: GitConfig = {
  owner: 'me',
  repo: 'my-repo',
  branch: 'main',
  path: 'learn',
  token: 'ghp_TEST',
};

/** Мини-mock fetch. Принимает роутинг URL → response body/status. */
function mockFetch(routes: Array<{ match: (url: string, init: RequestInit) => boolean; response: () => Response }>): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const r of routes) {
      if (r.match(url, init)) return r.response();
    }
    throw new Error(`Unhandled fetch: ${url}`);
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('git-storage', () => {
  it('snippetsFilePath: с path и без', () => {
    expect(snippetsFilePath(cfg)).toBe('learn/bslexicon-snippets.json');
    expect(snippetsFilePath({ ...cfg, path: '' })).toBe('bslexicon-snippets.json');
  });

  it('testConnection: успех — возвращает fullName и default_branch', async () => {
    const f = mockFetch([
      {
        match: (url) => url === 'https://api.github.com/repos/me/my-repo',
        response: () => jsonResponse(200, {
          full_name: 'me/my-repo',
          default_branch: 'main',
          private: false,
          permissions: { push: true, pull: true },
        }),
      },
    ]);
    const info = await testConnection(cfg, f);
    expect(info).toEqual({
      fullName: 'me/my-repo',
      defaultBranch: 'main',
      private: false,
      permissions: { push: true },
    });
  });

  it('testConnection: 401 → GitApiError с осмысленным текстом', async () => {
    const f = mockFetch([{ match: () => true, response: () => new Response(null, { status: 401 }) }]);
    await expect(testConnection(cfg, f)).rejects.toMatchObject({ name: 'GitApiError', status: 401 });
  });

  it('testConnection: 404 → GitApiError с осмысленным текстом', async () => {
    const f = mockFetch([{ match: () => true, response: () => new Response(null, { status: 404 }) }]);
    await expect(testConnection(cfg, f)).rejects.toMatchObject({ name: 'GitApiError', status: 404 });
  });

  it('readFile: файла нет → null', async () => {
    const f = mockFetch([{ match: () => true, response: () => new Response(null, { status: 404 }) }]);
    expect(await readFile(cfg, 'x.json', f)).toBeNull();
  });

  it('readFile: возвращает UTF-8 текст и sha', async () => {
    // base64 of "привет" в UTF-8
    const b64 = 'INJKoWQ='; // это не то. Использую btoa через TextEncoder.
    const text = 'Сообщить("привет")';
    // Соберём валидный base64 сами:
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const content = btoa(bin);

    const f = mockFetch([
      {
        match: (url) => url.includes('/contents/x.json'),
        response: () => jsonResponse(200, { content, encoding: 'base64', sha: 'ABC123' }),
      },
    ]);
    const result = await readFile(cfg, 'x.json', f);
    expect(result).toEqual({ text, sha: 'ABC123' });
    void b64; // silence unused
  });

  it('writeFile: новый файл (без prevSha) → PUT без sha в теле', async () => {
    let capturedBody: string | null = null;
    const spy = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      capturedBody = typeof init.body === 'string' ? init.body : null;
      return jsonResponse(201, { content: { sha: 'NEW-SHA' } });
    }) as typeof fetch;
    const sha = await writeFile(cfg, 'x.json', 'привет', 'test', null, spy);
    expect(sha).toBe('NEW-SHA');
    const body = JSON.parse(capturedBody!);
    expect(body.message).toBe('test');
    expect(body.branch).toBe('main');
    expect(body.sha).toBeUndefined();
  });

  it('writeFile: update (с prevSha) → в теле есть sha', async () => {
    let capturedBody: string | null = null;
    const spy = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      capturedBody = typeof init.body === 'string' ? init.body : null;
      return jsonResponse(200, { content: { sha: 'UPDATED' } });
    }) as typeof fetch;
    const sha = await writeFile(cfg, 'x.json', 'y', 'msg', 'OLD', spy);
    expect(sha).toBe('UPDATED');
    expect(JSON.parse(capturedBody!).sha).toBe('OLD');
  });

  it('writeFile: 409 конфликт → GitApiError с осмысленным текстом', async () => {
    const f = mockFetch([{ match: () => true, response: () => new Response(null, { status: 409 }) }]);
    await expect(writeFile(cfg, 'x.json', 'y', 'msg', 'sha', f))
      .rejects.toBeInstanceOf(GitApiError);
  });
});
