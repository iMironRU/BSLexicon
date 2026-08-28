/**
 * Типы для Judge — прогонки задач с чек-поинтами.
 *
 * Соответствуют [task-schema.json](../../docs/book-integration/task-schema.json)
 * v1, но со стороны runtime и UI (не Ajv-схема, а TS-типы для потребления
 * уже валидированного tasks.json).
 */

export type TestKind = 'stdout' | 'call';

export interface StdoutTest {
  kind: 'stdout';
  name?: string;
  expect: string;
  hidden?: boolean;
}

export interface CallTest {
  kind: 'call';
  name?: string;
  invoke: string;
  expect: string;
  hidden?: boolean;
}

export type TaskTest = StdoutTest | CallTest;

export type TaskDifficulty = 'intro' | 'easy' | 'medium' | 'hard';

export interface Task {
  id: string;
  title: string;
  chapter: string;
  section?: string;
  book_url?: string;
  statement: string;
  starter: string;
  tests: TaskTest[];
  hints?: string[];
  difficulty?: TaskDifficulty;
  tags?: string[];
}

export interface BookMeta {
  id: string;
  title: string;
  version: string;
  repo: string;
  site?: string;
}

export interface TasksFile {
  version: 1;
  book: BookMeta;
  tasks: Task[];
}

// ── Результаты прогонки ──────────────────────────────────────────────

export type TestStatus = 'pass' | 'fail' | 'error';

export interface TestResult {
  /** `hidden`-флаг из исходного теста — UI использует, чтобы не показать имя/expected/actual. */
  hidden: boolean;
  name?: string;
  kind: TestKind;
  status: TestStatus;
  /** Ожидаемое (для stdout — исходный `expect`, для call — вывод `Сообщить(expect)`). */
  expected?: string;
  /** Полученное (для stdout — весь вывод userCode, для call — вывод `Сообщить(invoke)`). */
  actual?: string;
  /** Текст ошибки, если `status === 'error'`. */
  error?: string;
}

export interface TaskResult {
  overall: 'pass' | 'fail' | 'error';
  tests: TestResult[];
}
