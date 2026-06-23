import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadCatalog } from '../app/catalog';
import { loadReference } from '../app/reference/load';
import type { SyntaxEntry } from '../app/reference/types';
import { Sidebar } from './Sidebar';
import { Card } from './Card';
import { Home } from './Home';
import { SearchOverlay } from './SearchOverlay';
import { TargetSelector } from './TargetSelector';
import { pushRecent } from './recent';
import { useHashRoute } from './router';
import { defaultTarget, loadTarget, saveTarget, versionsFromEntries } from './target';
import type { Target } from './target';

const TRAINER_URL = import.meta.env.BASE_URL; // '/' в dev, '/BSLexicon/' в build
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const HOTKEY_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K';

/**
 * Строит индекс CatalogEntry.id → SyntaxEntry. Ключ совпадает с тем,
 * как мы храним id в YAML-каталоге («СокрЛП» / «Массив.Добавить»).
 */
function indexSyntax(entries: readonly SyntaxEntry[]): Map<string, SyntaxEntry> {
  const map = new Map<string, SyntaxEntry>();
  for (const e of entries) {
    const id = e.kind === 'function' ? e.nameRu : `${e.owner}.${e.nameRu}`;
    map.set(id, e);
  }
  return map;
}

export function App() {
  const catalog = useMemo(() => loadCatalog(), []);
  const route = useHashRoute();
  const [searchOpen, setSearchOpen] = useState(false);
  const [syntaxEntries, setSyntaxEntries] = useState<SyntaxEntry[] | null>(null);
  const [target, setTargetState] = useState<Target>(() => defaultTarget());

  // Ленивая загрузка датасета 1С-выгрузки — для версий и контекстов.
  useEffect(() => {
    let alive = true;
    loadReference()
      .then((data) => {
        if (alive) setSyntaxEntries(data);
      })
      .catch(() => {
        /* отсутствие выгрузки не критично — селектор и индикаторы просто будут пусты */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Подтягиваем сохранённый target после монтирования (а не в инициализаторе),
  // чтобы SSR/preview не падали на ReferenceError localStorage.
  useEffect(() => {
    setTargetState(loadTarget());
  }, []);

  const syntaxIndex = useMemo(
    () => (syntaxEntries ? indexSyntax(syntaxEntries) : new Map<string, SyntaxEntry>()),
    [syntaxEntries],
  );

  const versions = useMemo(
    () => versionsFromEntries(syntaxEntries ?? []),
    [syntaxEntries],
  );

  const setTarget = useCallback((t: Target) => {
    setTargetState(t);
    saveTarget(t);
  }, []);

  const entry =
    route.kind === 'entry' ? catalog.byId.get(route.id) ?? null : null;

  /** Обновляем title страницы под текущую запись (для вкладки и для шаринга). */
  useEffect(() => {
    if (entry) {
      document.title = `${entry.id} — Синтакс-помощник BSL`;
    } else {
      document.title = 'Синтакс-помощник BSL';
    }
  }, [entry]);

  /** Любая открытая карточка попадает в историю — для пустого Cmd+K и образцов. */
  useEffect(() => {
    if (entry) pushRecent(entry.id);
  }, [entry]);

  /** Глобальный ⌘K / Ctrl+K — переключение поискового overlay'я. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === '/' && !searchOpen) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setSearchOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  const closeSearch = useCallback(() => setSearchOpen(false), []);

  return (
    <div className="help">
      <header className="help__header">
        <a className="help__brand" href={TRAINER_URL} title="Открыть тренажёр BSLexicon">
          <span className="help__logo">BSLexicon</span>
          <span className="help__tagline">Синтакс-помощник</span>
        </a>
        <div className="help__head-actions">
          <TargetSelector versions={versions} target={target} onChange={setTarget} />
          <button
            type="button"
            className="help__search-btn"
            onClick={() => setSearchOpen(true)}
            title={`Поиск (${HOTKEY_LABEL})`}
          >
            <span aria-hidden="true">🔎</span>
            <span className="help__search-label">Поиск</span>
            <kbd className="help__kbd">{HOTKEY_LABEL}</kbd>
          </button>
          <a className="help__back" href={TRAINER_URL}>
            ← Тренажёр
          </a>
        </div>
      </header>

      <main className="help__body">
        <section className="help__content">
          {route.kind === 'home' && <Home catalog={catalog} />}
          {route.kind === 'entry' && entry && (
            <Card
              catalog={catalog}
              entry={entry}
              syntax={syntaxIndex.get(entry.id) ?? null}
              target={target}
            />
          )}
          {route.kind === 'entry' && !entry && (
            <div className="help__missing">
              <h1>Не нашёл запись</h1>
              <p>
                В каталоге нет элемента <code>{route.id}</code> ({route.entryKind}).
              </p>
              <p>
                <a href="#/">На главную справочника</a>
              </p>
            </div>
          )}
          {route.kind === 'not-found' && (
            <div className="help__missing">
              <h1>Адрес не распознан</h1>
              <p>
                Не понял адрес <code>{route.raw}</code>. Используйте дерево справа
                или вернитесь на <a href="#/">главную</a>.
              </p>
            </div>
          )}
        </section>
        <Sidebar catalog={catalog} route={route} syntaxIndex={syntaxIndex} target={target} />
      </main>

      {searchOpen && (
        <SearchOverlay
          catalog={catalog}
          syntaxIndex={syntaxIndex}
          target={target}
          onClose={closeSearch}
        />
      )}
    </div>
  );
}
