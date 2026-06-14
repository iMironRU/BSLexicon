import type { BslValue } from './values';

/** Управление потоком реализовано через исключения, перехватываемые конструкциями. */

export class BreakSignal {}

export class ContinueSignal {}

export class ReturnSignal {
  constructor(public readonly value: BslValue | undefined) {}
}
