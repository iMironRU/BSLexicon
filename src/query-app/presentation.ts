/**
 * Представление ссылок в UI (#48).
 *
 * В настоящем 1С ссылка — это GUID; в интерфейсе на её месте
 * подставляется «представление»:
 *   - Справочник → `Наименование`
 *   - Документ  → `<НомерБезНулей> от <Дата>`
 *
 * В песочнице ссылки в фикстурах — короткие читаемые ключи (`n1`, `s_main`),
 * удобные для авторов данных. Показывать их в UI не стоит — у ученика
 * возникает ложная привычка «читать» ключ. Здесь резолвим значение
 * ячейки через `Fixture.byRef`: если попали в известную запись —
 * возвращаем представление; иначе — короткий псевдо-GUID (первые 8
 * символов hex-хэша ключа) для отладки. Сам сырой ключ уходит в тултип.
 */
import type { BslValue } from '@core/index';
import { NULL, UNDEFINED } from '@core/interpreter/values';
import type { Fixture, Row } from '../query/fixture';

export interface Presentation {
  /** Что показать в ячейке. */
  display: string;
  /** Сырое значение (полный ключ) — уходит в title/tooltip. Null для нессылок. */
  raw: string | null;
  /** Полное имя целевой таблицы, если удалось найти запись. */
  targetRef: string | null;
}

/**
 * Строит представление одного значения. Не бросает — при любой
 * неуверенности возвращает сырое значение (сохраняя семантику отладки).
 */
export function present(v: BslValue, fx: Fixture): Presentation {
  if (typeof v !== 'string' || !v) {
    return { display: fallbackDisplay(v), raw: null, targetRef: null };
  }
  const hit = lookupRef(v, fx);
  if (!hit) return { display: v, raw: null, targetRef: null };
  const { row, tableRef, kind } = hit;
  return {
    display: representationFor(row, kind) ?? pseudoGuid(v),
    raw: v,
    targetRef: tableRef,
  };
}

/** Ищет запись во всех таблицах фикстуры. Возвращает первое совпадение. */
function lookupRef(id: string, fx: Fixture): { row: Row; tableRef: string; kind: string } | null {
  for (const [tableRef, tf] of fx.tables) {
    const row = tf.byRef.get(id);
    if (row) return { row, tableRef, kind: tableRef.split('.')[0] };
  }
  return null;
}

function representationFor(row: Row, kind: string): string | null {
  switch (kind) {
    case 'Справочник': {
      const name = row['Наименование'];
      if (typeof name === 'string' && name) return name;
      const code = row['Код'];
      if (typeof code === 'string' && code) return code;
      return null;
    }
    case 'Документ': {
      const num = row['Номер'];
      const dt = row['Дата'];
      const numRaw = typeof num === 'string' ? num : num == null ? '' : String(num);
      const numStr = trimLeadingZeros(numRaw);
      const dtStr = typeof dt === 'string' ? formatDate(dt) : '';
      if (numStr && dtStr) return `№${numStr} от ${dtStr}`;
      if (numStr) return `№${numStr}`;
      return null;
    }
    default:
      return null;
  }
}

function trimLeadingZeros(s: string): string {
  const t = s.replace(/^0+/, '');
  return t || s;
}

function formatDate(v: string): string {
  if (!v) return '';
  // Дата приходит как ISO-строка "2024-01-15T10:00:00". Отрежем время.
  const day = v.slice(0, 10);
  const parts = day.split('-');
  if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return day;
}

/**
 * Короткий стабильный псевдо-GUID для случая, когда ссылка резолвится
 * в фикстуру, но представление собрать не удалось (у объекта нет
 * Наименования / Номера). Возвращаем 8 hex-символов детерминированного
 * хэша — чтобы у одного и того же id в разных ячейках вид был одинаков.
 */
function pseudoGuid(id: string): string {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function fallbackDisplay(v: BslValue): string {
  if (v === NULL || v === UNDEFINED) return '';
  if (typeof v === 'boolean') return v ? 'Истина' : 'Ложь';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return v.toFixed(6).replace(/\.?0+$/, '');
    return String(v);
  }
  if (typeof v === 'string') return v;
  return String(v);
}
