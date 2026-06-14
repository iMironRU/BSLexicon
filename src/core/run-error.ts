import { BslError } from './errors';

/** Этап конвейера, на котором возникла ошибка. */
export type RunStage = 'lexer' | 'parser' | 'runtime';

/** Ошибка выполнения для UI: этап, сообщение и (если известна) строка. */
export interface RunError {
  stage: RunStage;
  message: string;
  line?: number;
}

/** Приводит брошенное значение к `RunError` с указанием этапа. */
export function toRunError(stage: RunStage, e: unknown): RunError {
  if (e instanceof BslError) {
    return { stage, message: e.message, line: e.line };
  }
  return { stage, message: e instanceof Error ? e.message : String(e) };
}
