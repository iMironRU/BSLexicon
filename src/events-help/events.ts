import type { SyntaxEntry } from '../app/reference/types';

/**
 * Чистая логика отбора и группировки «событий» из полной выгрузки СП.
 *
 * Событием считаем запись с `kind: 'event'` — это специальный раздел в
 * .hbk-архиве (`objects/<TYPE>/events/<Имя><ID>.html`), отдельный от
 * methods/properties. extract-hbk-full.ts его теперь захватывает.
 */

export function isEvent(entry: SyntaxEntry): boolean {
  return entry.kind === 'event';
}

/** Канонические верхнеуровневые группы — порядок в дереве. */
export type GroupKey =
  | 'documents'
  | 'catalogs'
  | 'registers'
  | 'forms'
  | 'sequences'
  | 'businessProcesses'
  | 'tasks'
  | 'reports'
  | 'dataProcessors'
  | 'system'
  | 'other';

export const GROUP_LABELS: Record<GroupKey, string> = {
  documents: 'Документы',
  catalogs: 'Справочники',
  registers: 'Регистры',
  forms: 'Формы',
  sequences: 'Последовательности',
  businessProcesses: 'Бизнес-процессы',
  tasks: 'Задачи',
  reports: 'Отчёты',
  dataProcessors: 'Обработки',
  system: 'Системные',
  other: 'Прочее',
};

export const GROUP_ORDER: GroupKey[] = [
  'forms',
  'documents',
  'catalogs',
  'registers',
  'reports',
  'dataProcessors',
  'businessProcesses',
  'tasks',
  'sequences',
  'system',
  'other',
];

/** Определяет к какой группе относится owner записи. */
export function groupOf(owner: string): GroupKey {
  if (owner === 'Глобальный контекст') return 'system';
  if (owner.includes('Форма') || owner.includes('Поле') || owner.includes('Декорация')) return 'forms';
  if (owner.includes('Документ')) return 'documents';
  if (owner.includes('Справочник')) return 'catalogs';
  if (owner.includes('Регистр')) return 'registers';
  if (owner.includes('Последовательность')) return 'sequences';
  if (owner.includes('БизнесПроцесс')) return 'businessProcesses';
  if (owner.includes('Задача')) return 'tasks';
  if (owner.includes('Отчёт') || owner.includes('Отчет')) return 'reports';
  if (owner.includes('Обработка') && !owner.includes('Объект')) return 'dataProcessors';
  return 'other';
}

/** Фаза события — для подгруппы внутри owner-а (При, Перед, После, Обработка, Прочее). */
export type Phase = 'pre' | 'on' | 'post' | 'handle' | 'other';

export const PHASE_LABELS: Record<Phase, string> = {
  pre: 'Перед',
  on: 'При',
  post: 'После',
  handle: 'Обработка',
  other: 'Прочее',
};

export const PHASE_ORDER: Phase[] = ['pre', 'on', 'post', 'handle', 'other'];

export function phaseOf(nameRu: string): Phase {
  if (nameRu.startsWith('Перед')) return 'pre';
  if (nameRu.startsWith('При')) return 'on';
  if (nameRu.startsWith('После')) return 'post';
  if (nameRu.startsWith('Обработка')) return 'handle';
  return 'other';
}

export interface EventGroup {
  key: GroupKey;
  label: string;
  owners: { name: string; count: number }[]; // owner и его количество событий
  total: number;
}

/** Строит группировку: верхний уровень → группы → owner-ы (с count). */
export function buildGroups(events: readonly SyntaxEntry[]): EventGroup[] {
  // owner → count
  const byOwner = new Map<string, number>();
  // owner → group
  const ownerGroup = new Map<string, GroupKey>();
  for (const e of events) {
    byOwner.set(e.owner, (byOwner.get(e.owner) ?? 0) + 1);
    if (!ownerGroup.has(e.owner)) ownerGroup.set(e.owner, groupOf(e.owner));
  }
  // группа → owners[]
  const grouped = new Map<GroupKey, { name: string; count: number }[]>();
  for (const [owner, count] of byOwner) {
    const g = ownerGroup.get(owner) as GroupKey;
    const list = grouped.get(g) ?? [];
    list.push({ name: owner, count });
    grouped.set(g, list);
  }
  const result: EventGroup[] = [];
  for (const key of GROUP_ORDER) {
    const owners = grouped.get(key);
    if (!owners) continue;
    owners.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    result.push({
      key,
      label: GROUP_LABELS[key],
      owners,
      total: owners.reduce((n, o) => n + o.count, 0),
    });
  }
  return result;
}
