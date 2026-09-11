/**
 * Извлекает читаемое сообщение из чего угодно, что попало в catch: реальный
 * Error → .message; всё остальное (строка / объект / undefined) → String(e).
 *
 * Раньше эта одна строка повторялась в 9 catch-блоках по под-приложениям
 * (judge-help, events-help, full-help, notebook, ReferencePanel). Иногда
 * забывалась и превращалась в `String(e)` который на Error даёт "[object
 * Object]" — теперь один вход.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
