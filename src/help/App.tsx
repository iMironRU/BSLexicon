import { useEffect, useMemo } from 'react';
import { loadCatalog } from '../app/catalog';
import { Sidebar } from './Sidebar';
import { Card } from './Card';
import { Home } from './Home';
import { useHashRoute } from './router';

const TRAINER_URL = import.meta.env.BASE_URL; // '/' в dev, '/BSLexicon/' в build

export function App() {
  const catalog = useMemo(() => loadCatalog(), []);
  const route = useHashRoute();

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

  return (
    <div className="help">
      <header className="help__header">
        <a className="help__brand" href={TRAINER_URL} title="Открыть тренажёр BSLexicon">
          <span className="help__logo">BSLexicon</span>
          <span className="help__tagline">Синтакс-помощник</span>
        </a>
        <a className="help__back" href={TRAINER_URL}>
          ← Тренажёр
        </a>
      </header>

      <main className="help__body">
        <Sidebar catalog={catalog} route={route} />
        <section className="help__content">
          {route.kind === 'home' && <Home catalog={catalog} />}
          {route.kind === 'entry' && entry && <Card catalog={catalog} entry={entry} />}
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
                Не понял адрес <code>{route.raw}</code>. Используйте дерево слева
                или вернитесь на <a href="#/">главную</a>.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
