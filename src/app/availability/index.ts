/**
 * Warnings в редакторе тренажёра: проверка совместимости кода
 * с выбранной пользователем платформой (Target из `/help/`).
 *
 * MVP покрывает две конструкции — прямой вызов по имени и `Новый <Тип>()`.
 * Методы объектов не в scope (нужен type inference, см. #10).
 */

import { compareVersion, type ContextKey, type Target } from '../../help/target';

export interface IndexEntry {
  name: string;
  since?: string;
  contexts?: string[];
}

export interface AvailabilityIndex {
  functions: Record<string, IndexEntry>;
  types: Record<string, IndexEntry>;
}

const BASE = import.meta.env.BASE_URL;
let cache: Promise<AvailabilityIndex> | null = null;

export function loadAvailabilityIndex(): Promise<AvailabilityIndex> {
  if (!cache) {
    cache = fetch(`${BASE}reference/syntax-availability.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`syntax-availability.json (${r.status})`);
        return r.json() as Promise<AvailabilityIndex>;
      })
      .catch((e) => {
        // Не блокируем редактор — просто без warnings.
        // eslint-disable-next-line no-console
        console.warn('[availability] не загрузился индекс:', e);
        cache = null;
        return { functions: {}, types: {} };
      });
  }
  return cache;
}

export interface WarningReason {
  kind: 'function' | 'type';
  name: string;
  needsVersion?: string;      // если недоступно из-за версии
  missingContexts?: ContextKey[]; // если недоступно из-за контекста
}

/**
 * Проверяет одно имя (функцию или тип) на target. Возвращает `null`
 * если всё ок или запись не найдена (не в нашем индексе — не ругаемся).
 */
export function checkName(
  kind: 'function' | 'type',
  name: string,
  target: Target,
  index: AvailabilityIndex,
): WarningReason | null {
  const table = kind === 'function' ? index.functions : index.types;
  const entry = table[name.toLowerCase()];
  if (!entry) return null;

  if (target.version && entry.since && compareVersion(entry.since, target.version) > 0) {
    return { kind, name: entry.name, needsVersion: entry.since };
  }

  if (target.contexts.size > 0 && entry.contexts && entry.contexts.length > 0) {
    const available = new Set(entry.contexts as ContextKey[]);
    const missing: ContextKey[] = [];
    for (const c of target.contexts) if (!available.has(c)) missing.push(c);
    if (missing.length > 0) return { kind, name: entry.name, missingContexts: missing };
  }

  return null;
}

/** Человекочитаемое сообщение для marker.hoverMessage. */
export function reasonToMessage(r: WarningReason): string {
  if (r.needsVersion) {
    return `«${r.name}» доступно только с платформы ${r.needsVersion}. Проверь версию в /help/ → шапка «Платформа».`;
  }
  if (r.missingContexts && r.missingContexts.length > 0) {
    const labels = r.missingContexts.join(', ');
    return `«${r.name}» не работает в контексте: ${labels}. Проверь настройки в /help/ → шапка «Платформа».`;
  }
  return `«${r.name}» недоступно на текущей платформе.`;
}
