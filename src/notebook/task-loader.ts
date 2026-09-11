/**
 * Загрузчик и валидатор `.task.yaml` для учебной платформы (см. #28).
 *
 * Формат — тот же что и `task-schema.json` v1 из книжной интеграции
 * ([docs/book-integration/task-schema.json]), только `chapter`/`section`/
 * `book_url` опциональны для отдельно стоящих задач (в книге они
 * идентифицируют главу; в личной библиотеке педагога — не нужны).
 *
 * Здесь ТОЛЬКО парсинг + минимальная структурная валидация. Резолв
 * ссылок `ref` из репо (fetch, cache, SHA) — в #30 при подключении
 * `?nb-src=`. Здесь мы обеспечиваем формат и типы.
 */

import { load as yamlLoad } from 'js-yaml';
import { errorMessage } from '../app/error-message';
import type { TaskTest } from '../judge/types';
import type { TaskSpec } from './types';

export type TaskLoadResult =
  | { ok: true; spec: TaskSpec }
  | { ok: false; error: string };

/**
 * Парсит текст `.task.yaml` в `TaskSpec`. Возвращает ok=false с
 * человекочитаемым `error` (для показа в placeholder), никогда не
 * бросает наружу.
 */
export function parseTaskYaml(text: string): TaskLoadResult {
  let parsed: unknown;
  try {
    parsed = yamlLoad(text);
  } catch (e) {
    return { ok: false, error: `Битый YAML: ${errorMessage(e)}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Файл должен быть YAML-объектом' };
  }
  const obj = parsed as Record<string, unknown>;
  const statement = obj.statement;
  const starter = obj.starter;
  const tests = obj.tests;
  if (typeof statement !== 'string' || statement.trim() === '') {
    return { ok: false, error: 'Поле `statement` обязательно (markdown-условие)' };
  }
  if (typeof starter !== 'string') {
    return { ok: false, error: 'Поле `starter` обязательно (стартовый код, можно пустая строка)' };
  }
  if (!Array.isArray(tests) || tests.length === 0) {
    return { ok: false, error: 'Поле `tests` обязательно и должно содержать минимум один тест' };
  }
  const parsedTests: TaskTest[] = [];
  for (let i = 0; i < tests.length; i += 1) {
    const t = tests[i];
    if (!t || typeof t !== 'object') {
      return { ok: false, error: `tests[${i}]: должен быть объектом` };
    }
    const tt = t as Record<string, unknown>;
    if (tt.kind === 'stdout') {
      if (typeof tt.expect !== 'string') {
        return { ok: false, error: `tests[${i}]: для stdout нужно поле expect (строка)` };
      }
      parsedTests.push({
        kind: 'stdout',
        expect: tt.expect,
        name: typeof tt.name === 'string' ? tt.name : undefined,
        hidden: tt.hidden === true,
      });
    } else if (tt.kind === 'call') {
      if (typeof tt.invoke !== 'string' || typeof tt.expect !== 'string') {
        return { ok: false, error: `tests[${i}]: для call нужны invoke и expect (строки)` };
      }
      parsedTests.push({
        kind: 'call',
        invoke: tt.invoke,
        expect: tt.expect,
        name: typeof tt.name === 'string' ? tt.name : undefined,
        hidden: tt.hidden === true,
      });
    } else {
      return { ok: false, error: `tests[${i}]: kind должен быть "stdout" или "call"` };
    }
  }

  const spec: TaskSpec = {
    title: typeof obj.title === 'string' ? obj.title : undefined,
    statement,
    starter,
    tests: parsedTests,
    hints: Array.isArray(obj.hints)
      ? obj.hints.filter((h): h is string => typeof h === 'string')
      : undefined,
  };
  return { ok: true, spec };
}
