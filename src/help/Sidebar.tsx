import { useEffect, useMemo, useState } from 'react';
import type { Catalog, CatalogEntry } from '@core/index';
import { formatHash } from './router';
import type { Route } from './router';

interface SidebarProps {
  catalog: Catalog;
  route: Route;
}

/** Канонический порядок категорий функций (из правой панели в SPA). */
const CATEGORY_ORDER = [
  'Строки',
  'Числа',
  'Даты',
  'Коллекции',
  'Преобразование',
  'Форматирование',
  'Тип',
  'Прочее',
];

/** Имена примитивов — отдельная подгруппа в разделе «Типы». */
const PRIMITIVES = new Set(['Число', 'Строка', 'Булево', 'Дата', 'Неопределено', 'Null', 'Тип']);

interface Group {
  key: string;
  title: string;
  entries: CatalogEntry[];
}

function byNameRu(a: CatalogEntry, b: CatalogEntry): number {
  return a.names.ru.localeCompare(b.names.ru, 'ru');
}

/** Группы для дерева: функции по `category` + примитивы и коллекции. */
function buildGroups(catalog: Catalog): { functions: Group[]; types: Group[] } {
  const byCategory = new Map<string, CatalogEntry[]>();
  for (const fn of catalog.functions) {
    const list = byCategory.get(fn.category);
    if (list) list.push(fn);
    else byCategory.set(fn.category, [fn]);
  }
  const ordered = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort(),
  ];
  const functions: Group[] = ordered.map((category) => ({
    key: `fn:${category}`,
    title: category,
    entries: byCategory.get(category)!.slice().sort(byNameRu),
  }));

  const primitives: CatalogEntry[] = [];
  const collections: CatalogEntry[] = [];
  for (const t of catalog.types) {
    if (PRIMITIVES.has(t.id)) primitives.push(t);
    else collections.push(t);
  }
  const types: Group[] = [];
  if (primitives.length > 0) {
    types.push({ key: 'type:primitives', title: 'Примитивы', entries: primitives.slice().sort(byNameRu) });
  }
  if (collections.length > 0) {
    types.push({ key: 'type:collections', title: 'Коллекции', entries: collections.slice().sort(byNameRu) });
  }
  return { functions, types };
}

/** Группа, в которой лежит текущая активная запись (для авто-раскрытия). */
function groupOf(route: Route, groups: { functions: Group[]; types: Group[] }): string | null {
  if (route.kind !== 'entry') return null;
  if (route.entryKind === 'function') {
    return groups.functions.find((g) => g.entries.some((e) => e.id === route.id))?.key ?? null;
  }
  if (route.entryKind === 'type') {
    return groups.types.find((g) => g.entries.some((e) => e.id === route.id))?.key ?? null;
  }
  // method / property — относятся к типу-родителю; ищем тип
  const typeName = route.id.split('.', 1)[0];
  return groups.types.find((g) => g.entries.some((e) => e.id === typeName))?.key ?? null;
}

export function Sidebar({ catalog, route }: SidebarProps) {
  const groups = useMemo(() => buildGroups(catalog), [catalog]);
  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    const active = groupOf(route, groups);
    if (active) set.add(active);
    return set;
  }, [groups, route]);

  const [open, setOpen] = useState<Set<string>>(initialOpen);

  // Если маршрут поменялся и попал в свёрнутую группу — раскрываем её.
  useEffect(() => {
    const active = groupOf(route, groups);
    if (active && !open.has(active)) {
      const next = new Set(open);
      next.add(active);
      setOpen(next);
    }
  }, [route, groups, open]);

  const toggle = (key: string): void => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };

  return (
    <nav className="sb" aria-label="Содержание справочника">
      <a
        className={'sb__home' + (route.kind === 'home' ? ' sb__home--active' : '')}
        href="#/"
      >
        Главная
      </a>

      <Section title="Функции" groups={groups.functions} entryKind="function" route={route} open={open} onToggle={toggle} />
      <Section title="Типы" groups={groups.types} entryKind="type" route={route} open={open} onToggle={toggle} />
    </nav>
  );
}

interface SectionProps {
  title: string;
  groups: Group[];
  entryKind: 'function' | 'type';
  route: Route;
  open: Set<string>;
  onToggle: (key: string) => void;
}

function Section({ title, groups, entryKind, route, open, onToggle }: SectionProps) {
  if (groups.length === 0) return null;
  return (
    <div className="sb__section">
      <div className="sb__sectionTitle">{title}</div>
      <ul className="sb__list">
        {groups.map((g) => {
          const isOpen = open.has(g.key);
          return (
            <li key={g.key} className="sb__group">
              <button
                type="button"
                className={'sb__groupHead' + (isOpen ? ' sb__groupHead--open' : '')}
                onClick={() => onToggle(g.key)}
                aria-expanded={isOpen}
              >
                <span className="sb__chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span className="sb__groupName">{g.title}</span>
                <span className="sb__groupCount">{g.entries.length}</span>
              </button>
              {isOpen && (
                <ul className="sb__entries">
                  {g.entries.map((e) => {
                    const active = route.kind === 'entry' && route.entryKind === entryKind && route.id === e.id;
                    return (
                      <li key={e.id}>
                        <a
                          className={'sb__entry' + (active ? ' sb__entry--active' : '')}
                          href={formatHash({ kind: 'entry', entryKind, id: e.id })}
                          title={e.names.en}
                        >
                          {e.names.ru}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
