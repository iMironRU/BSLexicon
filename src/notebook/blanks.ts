/**
 * Fill-in-the-blank в task-cell (#34).
 *
 * Автор помечает редактируемые участки маркерами `//<<` и `//>>` прямо
 * в стартовом коде:
 *
 *   Функция Удвоить(х)
 *       //<<
 *       // TODO: верни удвоенное х
 *       //>>
 *   КонецФункции
 *
 * Ученик может редактировать ТОЛЬКО строки между маркерами. Остальное
 * (включая сами `//<<` / `//>>`) — readonly. Ученик видит границы явно —
 * это часть учебного дизайна, не UI-грязь.
 *
 * Реализация: парсим текущий `source` (не starter — маркеры живут в
 * тексте, потому парсинг всегда актуален), находим пары строк-маркеров,
 * возвращаем 1-indexed диапазоны СТРОК-КОНТЕНТА между ними.
 * Незакрытые пары игнорируем — считаем что автор недооформил.
 */

const OPEN_MARKER = /^\s*\/\/<<\s*/;
const CLOSE_MARKER = /^\s*\/\/>>\s*/;

export interface EditableRegion {
  /** Первая редактируемая строка (1-indexed, inclusive). */
  startLine: number;
  /** Последняя редактируемая строка (1-indexed, inclusive). */
  endLine: number;
}

/**
 * Возвращает список редактируемых регионов. Пустой массив = у задачи
 * нет fill-in-the-blank разметки (весь код editable, как в обычной
 * задаче).
 */
export function parseEditableRegions(source: string): EditableRegion[] {
  const lines = source.split('\n');
  const regions: EditableRegion[] = [];
  let openLineIdx = -1; // 0-indexed line номер открывающего маркера, -1 = нет открытого

  for (let i = 0; i < lines.length; i += 1) {
    if (OPEN_MARKER.test(lines[i])) {
      // Открытие. Если уже было открыто — предыдущее незакрытое, игнорируем.
      openLineIdx = i;
    } else if (CLOSE_MARKER.test(lines[i])) {
      if (openLineIdx >= 0 && i > openLineIdx + 1) {
        // start = строка после `//<<`, end = строка перед `//>>` (1-indexed)
        regions.push({ startLine: openLineIdx + 2, endLine: i });
      }
      openLineIdx = -1;
    }
  }
  return regions;
}

/** Быстрая проверка «есть ли в исходнике маркеры вообще». */
export function hasBlanks(source: string): boolean {
  return OPEN_MARKER.test(source) || /\n\s*\/\/>>\s*(\n|$)/.test(source);
  // Дешёвая эвристика — точность даёт parseEditableRegions.
}

/**
 * Строка `line` (1-indexed) целиком лежит внутри какого-то editable-региона?
 * Marker-строки (сами `//<<` / `//>>`) НЕ считаются редактируемыми.
 */
export function isLineEditable(line: number, regions: EditableRegion[]): boolean {
  if (regions.length === 0) return true; // задача без blanks — весь код editable
  return regions.some((r) => line >= r.startLine && line <= r.endLine);
}

/**
 * Полностью ли выделение `sel` лежит внутри editable-регионов? Пустое
 * выделение (курсор без selection) проверяется по одной строке.
 */
export function isSelectionEditable(
  startLine: number,
  endLine: number,
  regions: EditableRegion[],
): boolean {
  if (regions.length === 0) return true;
  // Каждая строка выделения должна попадать в какой-то из регионов.
  for (let line = startLine; line <= endLine; line += 1) {
    if (!isLineEditable(line, regions)) return false;
  }
  return true;
}
