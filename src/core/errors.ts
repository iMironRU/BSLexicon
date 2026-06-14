/** Базовый класс ошибок ядра с привязкой к строке исходника. */
export class BslError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ошибка лексического анализа (неизвестный символ, незакрытая строка). */
export class LexError extends BslError {}

/** Ошибка синтаксического анализа (неожиданный токен, незакрытая конструкция). */
export class ParseError extends BslError {}

/** Ошибка времени исполнения (неизвестная функция, неверный тип операнда). */
export class RuntimeError extends BslError {}

/**
 * Срабатывание watchdog'а бюджета шагов (вероятный бесконечный цикл).
 * Подкласс `RuntimeError`, но фатальный: `Попытка` его НЕ ловит — иначе
 * обработчик мог бы проглотить зацикливание.
 */
export class StepLimitError extends RuntimeError {}
