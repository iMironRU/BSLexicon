/**
 * Представление значений BSL в рантайме.
 *
 * Примитивы маппятся на нативные типы JS; `Неопределено` и `Null` —
 * уникальные синглтоны, чтобы их нельзя было спутать с `undefined`/`null` JS.
 * Коллекции (`Массив`, `Структура`, …) — ссылочные объекты, наследники
 * `BslObject` (конкретные классы — в `collections.ts`).
 */
export const UNDEFINED = Symbol('Неопределено');
export const NULL = Symbol('Null');

/**
 * База для всех ссылочных типов BSL (коллекции, КлючИЗначение).
 * Ссылочная семантика «бесплатна»: две переменные с одним объектом видят
 * изменения друг друга — учебный акцент концепции §4.
 */
export abstract class BslObject {
  /** Имя типа на русском (как у `ТипЗнч`). */
  abstract readonly typeName: string;
  /** Человекочитаемое содержимое для панели переменных; `depth` ограничивает вложенность. */
  abstract display(depth: number): string;
  /**
   * Глубокая копия для передачи по `Знач`. `seen` хранит уже скопированные
   * объекты — защита от бесконечной рекурсии на циклических ссылках
   * (напр. массив, добавленный в самого себя). Реализация ОБЯЗАНА положить
   * себя в `seen` до копирования вложенных значений.
   */
  abstract copy(seen: Map<BslObject, BslObject>): BslObject;
}

export type BslValue =
  | number
  | string
  | boolean
  | typeof UNDEFINED
  | typeof NULL
  | BslObject;

/**
 * Глубоко копирует значение для передачи по `Знач`: примитивы — как есть,
 * ссылочные объекты — через `copy()` с разделяемой картой `seen` (одинаковые
 * вложенные ссылки остаются одной ссылкой и в копии, циклы не зацикливают).
 */
export function copyValue(value: BslValue, seen: Map<BslObject, BslObject> = new Map()): BslValue {
  if (!(value instanceof BslObject)) return value;
  const already = seen.get(value);
  return already ?? value.copy(seen);
}

/** Имя типа значения на русском (как возвращал бы `ТипЗнч`). */
export function typeName(value: BslValue): string {
  switch (typeof value) {
    case 'number':
      return 'Число';
    case 'string':
      return 'Строка';
    case 'boolean':
      return 'Булево';
    default:
      if (value instanceof BslObject) return value.typeName;
      return value === NULL ? 'Null' : 'Неопределено';
  }
}

/** Истинность значения для условий (`Если`, `Пока`, `И`/`ИЛИ`). */
export function isTruthy(value: BslValue): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value !== '';
  if (value instanceof BslObject) return true;
  return false; // Неопределено / Null
}

/**
 * Приведение к строке как при `Строка(...)` / выводе `Сообщить`.
 * TODO: десятичный разделитель — запятая по локали 1С (сейчас точка JS).
 */
export function toBslString(value: BslValue): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
      return String(value);
    case 'boolean':
      return value ? 'Да' : 'Нет';
    default:
      if (value instanceof BslObject) return value.display(0);
      return '';
  }
}

/** Приведение к числу как при `Число(...)`. */
export function toNumber(value: BslValue): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const n = Number(value.trim().replace(',', '.'));
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Отображение значения в панели переменных (строки в кавычках, объекты — кратко). */
export function displayValue(value: BslValue, depth = 0): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value instanceof BslObject) return value.display(depth);
  return toBslString(value);
}
