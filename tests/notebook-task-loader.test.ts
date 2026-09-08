import { describe, expect, it } from 'vitest';
import { parseTaskYaml } from '../src/notebook/task-loader';

/**
 * Формат `.task.yaml` — переиспользование `task-schema.json` v1
 * с опциональными book-полями. Здесь проверяем парсер + минимальную
 * валидацию.
 */

describe('parseTaskYaml', () => {
  it('минимальный валидный YAML — stdout-тест', () => {
    const r = parseTaskYaml(`
statement: |
  Выведи 42
starter: |
  // ...
tests:
  - kind: stdout
    expect: "42"
`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.statement).toContain('42');
      expect(r.spec.tests).toHaveLength(1);
      expect(r.spec.tests[0]).toEqual({ kind: 'stdout', expect: '42', name: undefined, hidden: false });
    }
  });

  it('call-тест с invoke', () => {
    const r = parseTaskYaml(`
statement: Функция Удвоить
starter: ""
tests:
  - kind: call
    invoke: "Удвоить(5)"
    expect: "10"
`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.tests[0]).toEqual({
        kind: 'call', invoke: 'Удвоить(5)', expect: '10', name: undefined, hidden: false,
      });
    }
  });

  it('title и hints опциональны, но подхватываются', () => {
    const r = parseTaskYaml(`
title: Моя задача
statement: X
starter: ""
tests: [{ kind: stdout, expect: "" }]
hints:
  - подсказка 1
  - подсказка 2
`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.title).toBe('Моя задача');
      expect(r.spec.hints).toEqual(['подсказка 1', 'подсказка 2']);
    }
  });

  it('hidden-флаг теста', () => {
    const r = parseTaskYaml(`
statement: X
starter: ""
tests:
  - kind: stdout
    expect: "a"
    hidden: true
`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.tests[0].hidden).toBe(true);
  });

  it('битый YAML → ok: false с ошибкой', () => {
    const r = parseTaskYaml(':: не YAML ::');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/YAML/i);
  });

  it('без statement → ok: false', () => {
    const r = parseTaskYaml('starter: ""\ntests: [{kind: stdout, expect: "a"}]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/statement/i);
  });

  it('без tests → ok: false', () => {
    const r = parseTaskYaml('statement: X\nstarter: ""');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tests/i);
  });

  it('пустой массив tests → ok: false', () => {
    const r = parseTaskYaml('statement: X\nstarter: ""\ntests: []');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/минимум/i);
  });

  it('неизвестный kind теста → ok: false с индексом', () => {
    const r = parseTaskYaml(`
statement: X
starter: ""
tests:
  - kind: stdout
    expect: "a"
  - kind: странный
    expect: "b"
`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tests\[1\]/);
  });

  it('stdout без expect → ok: false', () => {
    const r = parseTaskYaml('statement: X\nstarter: ""\ntests: [{ kind: stdout }]');
    expect(r.ok).toBe(false);
  });

  it('call без invoke → ok: false', () => {
    const r = parseTaskYaml('statement: X\nstarter: ""\ntests: [{ kind: call, expect: "a" }]');
    expect(r.ok).toBe(false);
  });

  it('массив на верхнем уровне (не объект) → ok: false', () => {
    const r = parseTaskYaml('- foo\n- bar');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/объект/i);
  });
});
