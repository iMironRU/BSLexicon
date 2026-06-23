import type { SyntaxEntry } from '../app/reference/types';

/**
 * Модель «целевой платформы» — версия + набор контекстов исполнения, под
 * которые пользователь хочет видеть совместимость (как caniuse.com).
 *
 * Чистый модуль: никакой React-зависимости, тестируется без DOM. UI поверх —
 * в `TargetSelector.tsx`; персистентность в localStorage — на этом же уровне.
 */

export type ContextKey =
  | 'thin'
  | 'thick'
  | 'web'
  | 'server'
  | 'external'
  | 'mobile-client'
  | 'mobile-server'
  | 'mobile-standalone'
  | 'mobile-thin';

export const CONTEXT_LABELS: Record<ContextKey, string> = {
  thin: 'Тонкий клиент',
  thick: 'Толстый клиент',
  web: 'Веб-клиент',
  server: 'Сервер',
  external: 'Внешнее соединение',
  'mobile-client': 'Моб. приложение (клиент)',
  'mobile-server': 'Моб. приложение (сервер)',
  'mobile-standalone': 'Моб. автономный сервер',
  'mobile-thin': 'Мобильный клиент',
};

export const ALL_CONTEXTS: ContextKey[] = [
  'thin',
  'thick',
  'web',
  'server',
  'external',
  'mobile-client',
  'mobile-server',
  'mobile-standalone',
  'mobile-thin',
];

export interface Target {
  /** Выбранная версия (`"8.3.18"`) или `null` — не фильтровать по версии. */
  version: string | null;
  /** Набор включённых контекстов. Пустой — не фильтровать по контексту. */
  contexts: ReadonlySet<ContextKey>;
}

export type Verdict = 'yes' | 'no' | 'unknown';

/**
 * Сравнение версий «MAJOR.MINOR[.PATCH][.BUILD]» с подразумеваемым нулём.
 * Возвращает <0/0/>0 по соглашению JS comparator.
 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Причина «недоступности». `null` — значит запись доступна или
 * данных недостаточно.
 */
export interface BlockReason {
  /** Запись требует более свежей версии — указано какой. */
  needsVersion?: string;
  /** Не хватает контекстов из target, в которых запись работает. */
  missingContexts?: ContextKey[];
}

/** Сводный вердикт по записи под выбранной целью. */
export function isAvailable(entry: SyntaxEntry, target: Target): Verdict {
  return verdict(entry, target).verdict;
}

/** Подробный вердикт: причина блокировки для UI. */
export function verdict(entry: SyntaxEntry, target: Target): { verdict: Verdict; reason: BlockReason } {
  const hasData = !!entry.since || (entry.availabilityKeys?.length ?? 0) > 0;
  if (!hasData) return { verdict: 'unknown', reason: {} };

  if (target.version && entry.since && compareVersion(entry.since, target.version) > 0) {
    return { verdict: 'no', reason: { needsVersion: entry.since } };
  }

  if (target.contexts.size > 0 && entry.availabilityKeys && entry.availabilityKeys.length > 0) {
    const available = new Set(entry.availabilityKeys as ContextKey[]);
    const missing: ContextKey[] = [];
    for (const ctx of target.contexts) if (!available.has(ctx)) missing.push(ctx);
    // «Доступен у меня» = ВСЕ выбранные контексты есть в availability.
    // Это даёт строгий фильтр: «выберу клиент+сервер — покажет только то, что и там, и там».
    if (missing.length > 0) return { verdict: 'no', reason: { missingContexts: missing } };
  }

  return { verdict: 'yes', reason: {} };
}

/** Уникальный список since в порядке убывания (для селектора). */
export function versionsFromEntries(entries: readonly SyntaxEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) if (e.since) set.add(e.since);
  return [...set].sort(compareVersion).reverse();
}

// ── localStorage ──────────────────────────────────────────────────────

const KEY = 'bslexicon:help:target';

interface Persisted {
  version: string | null;
  contexts: ContextKey[];
}

export function loadTarget(): Target {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultTarget();
    const p = JSON.parse(raw) as Persisted;
    return {
      version: typeof p.version === 'string' ? p.version : null,
      contexts: new Set(Array.isArray(p.contexts) ? p.contexts.filter(isContextKey) : []),
    };
  } catch {
    return defaultTarget();
  }
}

export function saveTarget(t: Target): void {
  try {
    const payload: Persisted = { version: t.version, contexts: [...t.contexts] };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // storage недоступен — игнорируем
  }
}

export function defaultTarget(): Target {
  return { version: null, contexts: new Set() };
}

function isContextKey(s: unknown): s is ContextKey {
  return typeof s === 'string' && (ALL_CONTEXTS as readonly string[]).includes(s);
}
