/**
 * Тесты режимов notebook'а (#27): initial mode из URL, форс через
 * ?mode=, добавление mode=student к share-ссылке.
 */
import { describe, expect, it } from 'vitest';
import { initialMode, withStudentMode } from '../src/notebook/mode';

describe('initialMode', () => {
  it('пустой URL → author', () => {
    expect(initialMode('')).toBe('author');
  });

  it('?nb=... без mode → student (защитный дефолт)', () => {
    expect(initialMode('?nb=abcdef')).toBe('student');
  });

  it('?nb-src=... без mode → student', () => {
    expect(initialMode('?nb-src=https://example.com/x.nb.json')).toBe('student');
  });

  it('?mode=student — форс', () => {
    expect(initialMode('?mode=student')).toBe('student');
  });

  it('?mode=author — форс поверх ?nb=', () => {
    expect(initialMode('?nb=abcdef&mode=author')).toBe('author');
  });

  it('невалидный ?mode= → нормальные правила', () => {
    expect(initialMode('?nb=x&mode=hackerman')).toBe('student');
    expect(initialMode('?mode=nope')).toBe('author');
  });
});

describe('withStudentMode', () => {
  it('добавляет mode=student, если параметра нет', () => {
    const url = withStudentMode('http://example.com/notebook/?nb=xyz');
    expect(url).toContain('mode=student');
    expect(url).toContain('nb=xyz');
  });

  it('перезаписывает существующий mode=author', () => {
    const url = withStudentMode('http://example.com/notebook/?nb=xyz&mode=author');
    expect(url).toContain('mode=student');
    expect(url).not.toContain('mode=author');
  });

  it('не ломается на не-URL', () => {
    expect(withStudentMode('обычная строка')).toBeTruthy();
  });
});
