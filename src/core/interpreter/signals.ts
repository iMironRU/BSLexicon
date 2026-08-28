import type { BslValue } from './values';

/** Управление потоком реализовано через исключения, перехватываемые конструкциями. */

export class BreakSignal {}

export class ContinueSignal {}

export class ReturnSignal {
  constructor(public readonly value: BslValue | undefined) {}
}

/**
 * Прыжок на метку `Перейти ~Имя`. Пробрасывается через `Если`/`Пока`/`Для`
 * до ближайшего блока, где эта метка объявлена. Если не находится нигде —
 * runtime error.
 */
export class GotoSignal {
  constructor(public readonly name: string) {}
}
