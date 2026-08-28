/**
 * Прогонка задач Judge.
 *
 * Каждый тест выполняется через `run()` из `@core/index` — тот же
 * интерпретатор, что и в тренажёре. Так гарантируем: если задача
 * проходит в judge, она пройдёт и когда читатель нажмёт «Запустить»
 * в тренажёре.
 *
 * Стратегия для двух видов тестов:
 *
 * - **stdout** — прогоняем `userCode`, сравниваем `output` построчно
 *   с `expect` (лишние пробелы справа игнорируем).
 * - **call** — прогоняем `userCode + Сообщить(invoke)` и отдельно
 *   `Сообщить(expect)`, сравниваем строки. Так интерпретатор сам
 *   обеспечивает единое строковое представление для чисел, дробей,
 *   Истина/Ложь/Неопределено — нам не надо руками парсить expect.
 *   Изолированный второй прогон нужен, чтобы `expect` не мог видеть
 *   определения `userCode` (это литерал, а не выражение над кодом).
 */

import { run } from '@core/index';
import type { RunResult } from '@core/index';
import type { StdoutTest, CallTest, Task, TaskResult, TaskTest, TestResult } from './types';

/**
 * Основная точка: прогнать все тесты задачи и вернуть агрегированный
 * результат. Никогда не бросает — все ошибки конвертируются в
 * `TestResult` со `status: 'error'`.
 */
export function runTask(task: Task, userCode: string): TaskResult {
  const tests = task.tests.map((t) => runOneTest(t, userCode));
  return { tests, overall: aggregate(tests) };
}

function aggregate(tests: TestResult[]): TaskResult['overall'] {
  if (tests.some((t) => t.status === 'error')) return 'error';
  if (tests.every((t) => t.status === 'pass')) return 'pass';
  return 'fail';
}

function runOneTest(test: TaskTest, userCode: string): TestResult {
  return test.kind === 'stdout'
    ? runStdoutTest(test, userCode)
    : runCallTest(test, userCode);
}

// ── stdout ───────────────────────────────────────────────────────────

function runStdoutTest(test: StdoutTest, userCode: string): TestResult {
  const base: Pick<TestResult, 'hidden' | 'name' | 'kind'> = {
    hidden: test.hidden === true,
    name: test.name,
    kind: 'stdout',
  };

  const result = run(userCode);
  if (!result.ok) {
    return { ...base, status: 'error', error: formatRunError(result), expected: test.expect };
  }
  const actual = result.output.join('\n');
  const expected = test.expect;
  return {
    ...base,
    status: outputEquals(actual, expected) ? 'pass' : 'fail',
    expected,
    actual,
  };
}

// ── call ─────────────────────────────────────────────────────────────

function runCallTest(test: CallTest, userCode: string): TestResult {
  const base: Pick<TestResult, 'hidden' | 'name' | 'kind'> = {
    hidden: test.hidden === true,
    name: test.name,
    kind: 'call',
  };

  // 1. Прогон expect в чистом контексте — получаем его каноническое
  //    строковое представление через Сообщить().
  const expectRun = run(`Сообщить(${test.expect});`);
  if (!expectRun.ok) {
    // Ошибка в expect — это баг задачи, не читателя. Сообщаем явно.
    return {
      ...base,
      status: 'error',
      error: `Ожидаемое значение «${test.expect}» невычислимо: ${formatRunError(expectRun)}`,
    };
  }
  const expectedStr = expectRun.output.join('\n');

  // 2. Прогон userCode + Сообщить(invoke).
  const src = `${userCode}\nСообщить(${test.invoke});`;
  const invokeRun = run(src);
  if (!invokeRun.ok) {
    return {
      ...base,
      status: 'error',
      error: formatRunError(invokeRun),
      expected: expectedStr,
    };
  }

  // Если userCode сам что-то печатает (Сообщить), это до нашего вызова.
  // Берём последнюю строку вывода — она наша.
  const lines = invokeRun.output;
  const actualStr = lines.length === 0 ? '' : lines[lines.length - 1];

  return {
    ...base,
    status: outputEquals(actualStr, expectedStr) ? 'pass' : 'fail',
    expected: expectedStr,
    actual: actualStr,
  };
}

// ── Сравнение ────────────────────────────────────────────────────────

/**
 * Построчное сравнение с игнорированием trailing whitespace.
 * Пустые строки в конце тоже игнорируем — вывод BSL иногда добавляет
 * их случайно, читателя это не должно наказывать.
 */
function outputEquals(actual: string, expected: string): boolean {
  const norm = (s: string): string =>
    s
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n')
      .replace(/\n+$/, '');
  return norm(actual) === norm(expected);
}

function formatRunError(result: RunResult): string {
  if (result.ok) return '';
  const e = result.error;
  const line = e.line ? ` (строка ${e.line})` : '';
  const label =
    e.stage === 'lexer' ? 'Ошибка лексера' :
    e.stage === 'parser' ? 'Ошибка парсера' :
    'Ошибка выполнения';
  return `${label}${line}: ${e.message}`;
}
