import type { Catalog } from '@core/index';
import { formatHash } from './router';

interface HomeProps {
  catalog: Catalog;
}

export function Home({ catalog }: HomeProps) {
  const counts = {
    functions: catalog.functions.length,
    types: catalog.types.length,
    methods: catalog.methods.length,
    properties: catalog.entries.filter((e) => e.kind === 'property').length,
  };

  return (
    <article className="home">
      <h1 className="home__title">Синтакс-помощник BSL</h1>
      <p className="home__lead">
        Справочник по встроенному языку 1С (BSL): типы, функции, методы и свойства.
        Записи в каталоге исполняются в <a href={import.meta.env.BASE_URL}>тренажёре</a>{' '}
        и проходят doctest в CI — то, что здесь, гарантированно работает.
      </p>

      <dl className="home__stats">
        <dt>Функций</dt>
        <dd>{counts.functions}</dd>
        <dt>Типов</dt>
        <dd>{counts.types}</dd>
        <dt>Методов</dt>
        <dd>{counts.methods}</dd>
        <dt>Свойств</dt>
        <dd>{counts.properties}</dd>
      </dl>

      <section className="home__section">
        <h2>С чего начать</h2>
        <ul className="home__hints">
          <li>
            Тренажёр и пошаговая отладка — <a href={import.meta.env.BASE_URL}>BSLexicon</a>.
          </li>
          <li>Дерево слева сгруппировано по категориям функций и по типам.</li>
          <li>
            Каждая карточка содержит deep-link: можно поделиться ссылкой на конкретный
            метод или свойство.
          </li>
          <li>
            Примеры запускаются в тренажёре одной кнопкой «▶ В тренажёре».
          </li>
        </ul>
      </section>

      <section className="home__section">
        <h2>Типы</h2>
        <ul className="home__chips">
          {catalog.types.map((t) => (
            <li key={t.id}>
              <a className="chip" href={formatHash({ kind: 'entry', entryKind: 'type', id: t.id })}>
                {t.names.ru}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
