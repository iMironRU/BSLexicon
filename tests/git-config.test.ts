import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearGitConfig, loadGitConfig, normalizePath, saveGitConfig } from '../src/app/git-config';

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

describe('git-config', () => {
  beforeEach(() => { installLocalStorage(); });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('пустое хранилище → null', () => {
    expect(loadGitConfig()).toBeNull();
  });

  it('save + load возвращает нормализованный конфиг', () => {
    saveGitConfig({ owner: '  me  ', repo: 'my-repo', branch: '  main  ', path: '/learn/', token: '  ghp_x  ' });
    const cfg = loadGitConfig();
    expect(cfg).toEqual({
      owner: 'me',
      repo: 'my-repo',
      branch: 'main',
      path: 'learn',
      token: 'ghp_x',
    });
  });

  it('пустая branch превращается в main', () => {
    saveGitConfig({ owner: 'a', repo: 'b', branch: '', path: '', token: 'x' });
    expect(loadGitConfig()?.branch).toBe('main');
  });

  it('clear стирает', () => {
    saveGitConfig({ owner: 'a', repo: 'b', branch: 'main', path: '', token: 'x' });
    clearGitConfig();
    expect(loadGitConfig()).toBeNull();
  });

  it('normalizePath убирает ведущие/висячие слэши и пробелы', () => {
    expect(normalizePath('  /a/b/c/  ')).toBe('a/b/c');
    expect(normalizePath('/')).toBe('');
    expect(normalizePath('')).toBe('');
    expect(normalizePath('folder')).toBe('folder');
  });

  it('битый JSON в storage → null', () => {
    localStorage.setItem('bslexicon:git:config', '{not-json');
    expect(loadGitConfig()).toBeNull();
  });

  it('storage недоступен → save/load не бросают', () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(() => saveGitConfig({ owner: 'a', repo: 'b', branch: 'main', path: '', token: 'x' })).not.toThrow();
    expect(loadGitConfig()).toBeNull();
  });
});
