/**
 * Проверяем, что composite action для book-check валиден по формату
 * GitHub Actions: обязательные поля, шаги корректны, входы имеют
 * дефолты, шелл-команда действительно ссылается на существующий скрипт.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

interface Action {
  name: string;
  description: string;
  runs: { using: string; steps: unknown[] };
  inputs?: Record<string, { default?: string; required?: boolean; description?: string }>;
}

const actionPath = join(__dirname, '..', '.github', 'actions', 'book-check', 'action.yml');
const raw = readFileSync(actionPath, 'utf8');
const action = load(raw) as Action;

describe('.github/actions/book-check', () => {
  it('обязательные поля заполнены', () => {
    expect(action.name).toMatch(/book-check/i);
    expect(action.description.length).toBeGreaterThan(20);
    expect(action.runs.using).toBe('composite');
    expect(action.runs.steps.length).toBeGreaterThanOrEqual(4);
  });

  it('входы имеют дефолты', () => {
    expect(action.inputs?.path?.default).toBe('.');
    expect(action.inputs?.['bslexicon-ref']?.default).toBe('main');
    expect(action.inputs?.['node-version']?.default).toBe('24');
  });

  it('checkout использует actions/checkout@v4', () => {
    const step = action.runs.steps.find((s) =>
      typeof s === 'object' && s !== null && (s as { uses?: string }).uses?.includes('actions/checkout'),
    );
    expect(step).toBeDefined();
    expect((step as { uses: string }).uses).toBe('actions/checkout@v4');
  });

  it('setup-node использует v4', () => {
    const step = action.runs.steps.find((s) =>
      typeof s === 'object' && s !== null && (s as { uses?: string }).uses?.includes('actions/setup-node'),
    );
    expect(step).toBeDefined();
    expect((step as { uses: string }).uses).toBe('actions/setup-node@v4');
  });

  it('финальный шаг запускает scripts/book-check.ts', () => {
    const runStep = action.runs.steps.find((s) =>
      typeof s === 'object' && s !== null && typeof (s as { run?: string }).run === 'string' && (s as { run: string }).run.includes('book-check.ts'),
    );
    expect(runStep).toBeDefined();
    // Скрипт действительно существует
    const scriptPath = join(__dirname, '..', 'scripts', 'book-check.ts');
    expect(readFileSync(scriptPath, 'utf8')).toMatch(/parseBookYaml|parseQueryTaskYaml/);
  });
});
