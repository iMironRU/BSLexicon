/**
 * Представление значений BSL в рантайме.
 *
 * Примитивы маппятся на нативные типы JS; `Неопределено` и `Null` —
 * уникальные синглтоны, чтобы их нельзя было спутать с `undefined`/`null` JS.
 */
export const UNDEFINED = Symbol('Неопределено');
export const NULL = Symbol('Null');

export type BslValue = number | string | boolean | typeof UNDEFINED | typeof NULL;

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
      return value === NULL ? 'Null' : 'Неопределено';
  }
}

/** Истинность значения для условий (`Если`, `Пока`, `И`/`ИЛИ`). */
export function isTruthy(value: BslValue): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === UNDEFINED || value === NULL) return false;
  return value !== '';
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

/** Отображение значения в панели переменных (строки в кавычках). */
export function displayValue(value: BslValue): string {
  if (typeof value === 'string') return `"${value}"`;
  return toBslString(value);
}
