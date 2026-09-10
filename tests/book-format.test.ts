import { describe, expect, it } from 'vitest';
import { parseBookYaml } from '../src/book/book-format';

describe('parseBookYaml', () => {
  it('минимальный валидный YAML', () => {
    const r = parseBookYaml(`
title: Мини-книга
chapters:
  - title: Глава 1
    notebook: notebooks/01.nb.json
`);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.title).toBe('Мини-книга');
    expect(r.value.chapters).toHaveLength(1);
    expect(r.value.chapters[0].title).toBe('Глава 1');
    expect(r.value.chapters[0].notebook).toBe('notebooks/01.nb.json');
  });

  it('автор и версия — опциональные', () => {
    const r = parseBookYaml(`
title: X
author: Иван Иванов
version: "1.2.3"
chapters: [{title: A, notebook: a.nb.json}]
`);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.author).toBe('Иван Иванов');
    expect(r.value.version).toBe('1.2.3');
  });

  it('описание — Markdown', () => {
    const r = parseBookYaml(`
title: X
description: |
  # О книге
  Учимся SDBL.
chapters: [{title: A, notebook: a.nb.json}]
`);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.description).toContain('О книге');
  });

  it('summary у главы — опциональный', () => {
    const r = parseBookYaml(`
title: X
chapters:
  - {title: A, notebook: a.nb.json, summary: "Про запросы"}
`);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.chapters[0].summary).toBe('Про запросы');
  });

  it('без title — ошибка', () => {
    const r = parseBookYaml(`chapters: [{title: A, notebook: a.nb.json}]`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/title/i);
  });

  it('без chapters — ошибка', () => {
    const r = parseBookYaml(`title: X`);
    expect(r.ok).toBe(false);
  });

  it('пустой массив chapters — ошибка', () => {
    const r = parseBookYaml(`title: X\nchapters: []`);
    expect(r.ok).toBe(false);
  });

  it('глава без notebook — ошибка с номером', () => {
    const r = parseBookYaml(`
title: X
chapters:
  - title: A
    notebook: a.nb.json
  - title: B
`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/#2|notebook/i);
  });

  it('битый YAML → понятная ошибка', () => {
    const r = parseBookYaml(`{{ битый`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/YAML/i);
  });
});
