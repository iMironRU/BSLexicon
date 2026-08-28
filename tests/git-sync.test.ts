import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitConfig } from '../src/app/git-config';
import { GitApiError } from '../src/app/git-storage';
import { syncPull, syncPush } from '../src/app/git-sync';
import { listSnippets, saveSnippet } from '../src/app/snippets';

const cfg: GitConfig = {
  owner: 'me',
  repo: 'my-repo',
  branch: 'main',
  path: '',
  token: 'ghp_TEST',
};

function installLocalStorage(): void {
  const store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

/**
 * Fake GitHub Contents API — держит один файл в памяти, отвечает как
 * настоящий (200 c base64 content + sha, 404 если нет, 409 если sha
 * не совпал). Всех действий достаточно чтобы прогнать push→pull.
 */
function fakeGithub(): { fetch: typeof fetch; getFile: () => string | null } {
  let sha: string | null = null;
  let content: string | null = null; // base64
  let ver = 0;

  const nextSha = (): string => {
    ver += 1;
    return `sha-${ver}`;
  };

  const impl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init.method ?? 'GET';

    if (method === 'GET' && url.includes('/contents/')) {
      if (content === null) return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({ content, encoding: 'base64', sha }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (method === 'PUT' && url.includes('/contents/')) {
      const body = JSON.parse(String(init.body)) as { content: string; sha?: string };
      if (sha !== null && body.sha !== sha) {
        return new Response(null, { status: 409 });
      }
      content = body.content;
      sha = nextSha();
      return new Response(
        JSON.stringify({ content: { sha } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(null, { status: 404 });
  };

  return {
    fetch: impl as typeof fetch,
    getFile: () => {
      if (!content) return null;
      // base64 → utf8
      const bin = Buffer.from(content, 'base64').toString('utf8');
      return bin;
    },
  };
}

describe('git-sync', () => {
  beforeEach(() => { installLocalStorage(); });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('push: пустой репо → создаёт файл', async () => {
    const gh = fakeGithub();
    saveSnippet('a', 'code A', 1000);
    saveSnippet('b', 'code B', 2000);
    const result = await syncPush(cfg, listSnippets(), gh.fetch);
    expect(result.path).toBe('bslexicon-snippets.json');
    expect(result.sha).toBe('sha-1');
    const file = gh.getFile();
    expect(file).toBeTruthy();
    const parsed = JSON.parse(file!);
    expect(parsed.version).toBe(1);
    expect(parsed.items.map((s: { name: string }) => s.name).sort()).toEqual(['a', 'b']);
  });

  it('push поверх существующего → передаёт prevSha', async () => {
    const gh = fakeGithub();
    saveSnippet('a', 'v1', 1000);
    const first = await syncPush(cfg, listSnippets(), gh.fetch);
    saveSnippet('b', 'v2', 2000);
    const second = await syncPush(cfg, listSnippets(), gh.fetch);
    expect(second.sha).not.toBe(first.sha); // sha обновилась
    const file = JSON.parse(gh.getFile()!);
    expect(file.items.map((s: { name: string }) => s.name).sort()).toEqual(['a', 'b']);
  });

  it('pull: файла нет → kind: empty', async () => {
    const gh = fakeGithub();
    const result = await syncPull(cfg, gh.fetch);
    expect(result.kind).toBe('empty');
  });

  it('round-trip: push A → pull B восстанавливает', async () => {
    const gh = fakeGithub();

    // «Первое устройство» — пишет 2 сниппета и пушит
    saveSnippet('первый', 'Сообщить("привет");', 1000);
    saveSnippet('второй', 'Для К = 1 По 3 Цикл\n  Сообщить(К);\nКонецЦикла;', 2000);
    await syncPush(cfg, listSnippets(), gh.fetch);

    // «Второе устройство» — свежий localStorage, пуллит
    installLocalStorage();
    expect(listSnippets()).toEqual([]);
    const result = await syncPull(cfg, gh.fetch);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.items.map((s) => s.name).sort()).toEqual(['второй', 'первый']);
    // storage тоже наполнен
    expect(listSnippets().map((s) => s.name).sort()).toEqual(['второй', 'первый']);
    // код и utf8 не порезался
    const found = listSnippets().find((s) => s.name === 'первый');
    expect(found?.code).toBe('Сообщить("привет");');
  });

  it('pull → push поверх → pull возвращает актуальную версию', async () => {
    const gh = fakeGithub();
    saveSnippet('v1', 'x', 1000);
    await syncPush(cfg, listSnippets(), gh.fetch);

    // Устройство B: pull, редактирует, push
    installLocalStorage();
    await syncPull(cfg, gh.fetch);
    saveSnippet('v2', 'y', 2000);
    await syncPush(cfg, listSnippets(), gh.fetch);

    // Устройство C: pull — должно получить обе
    installLocalStorage();
    const result = await syncPull(cfg, gh.fetch);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.items.map((s) => s.name).sort()).toEqual(['v1', 'v2']);
  });

  it('push с path: файл лежит в подпапке', async () => {
    const gh = fakeGithub();
    saveSnippet('a', 'x', 1000);
    const cfgWithPath = { ...cfg, path: 'learn' };
    const result = await syncPush(cfgWithPath, listSnippets(), gh.fetch);
    expect(result.path).toBe('learn/bslexicon-snippets.json');
  });

  it('push: 401 от GitHub → пробрасывает GitApiError', async () => {
    const bad = ((async () => new Response(null, { status: 401 })) as unknown) as typeof fetch;
    saveSnippet('a', 'x', 1000);
    await expect(syncPush(cfg, listSnippets(), bad)).rejects.toBeInstanceOf(GitApiError);
  });

  it('pull: битый JSON в файле → GitApiError', async () => {
    // Готовим fake где файл есть, но содержит мусор
    const bad = (async () => {
      const b64 = Buffer.from('{not json').toString('base64');
      return new Response(
        JSON.stringify({ content: b64, encoding: 'base64', sha: 'x' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    await expect(syncPull(cfg, bad)).rejects.toBeInstanceOf(GitApiError);
  });
});
