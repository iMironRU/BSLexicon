import { useEffect, useState } from 'react';
import { HelpFooter } from '../help/HelpFooter';
import { Loader } from '../help/Loader';
import { NavMenu } from '../help/NavMenu';
import { PwaBanners } from '../app/components/PwaBanners';
import { ToastHost } from '../app/toast/toast';
import { runTask } from '../judge/runner';
import type { Task, TaskResult, TasksFile } from '../judge/types';
import { findTask, loadBookTasks, loadJudgeIndex, type JudgeIndex } from './loader';
import { getProgress, loadProgress, markPassed, saveDraft, type ProgressMap } from './progress';
import { TaskPage } from './TaskPage';
import { Home } from './Home';

const TRAINER_URL = import.meta.env.BASE_URL;
const HELP_URL = `${import.meta.env.BASE_URL}help/`;

type Route =
  | { kind: 'home' }
  | { kind: 'task'; bookId: string; taskId: string }
  | { kind: 'not-found'; raw: string };

function parseHash(hash: string): Route {
  const t = hash.replace(/^#\/?/, '');
  if (t === '') return { kind: 'home' };
  const m = t.match(/^task\/([^/]+)\/(.+)$/);
  if (m) {
    try {
      return { kind: 'task', bookId: decodeURIComponent(m[1]), taskId: decodeURIComponent(m[2]) };
    } catch {
      return { kind: 'not-found', raw: t };
    }
  }
  return { kind: 'not-found', raw: t };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const [index, setIndex] = useState<JudgeIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadJudgeIndex()
      .then((i) => alive && setIndex(i))
      .catch((e: unknown) => alive && setIndexError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onHash = (): void => setSidebarOpen(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const handlePassed = (bookId: string, taskId: string, solution: string): void => {
    setProgress(markPassed(bookId, taskId, solution));
  };

  const handleDraft = (bookId: string, taskId: string, solution: string): void => {
    saveDraft(bookId, taskId, solution);
    // не пере-запускаем setProgress — draft-запись не влияет на «пройдено»
  };

  return (
    <ToastHost>
    <div className="help">
      <header className="help__header">
        <a className="help__brand" href={TRAINER_URL} title="К тренажёру">
          <span className="help__logo">BSLexicon</span>
          <span className="help__tagline">Задачи Judge</span>
        </a>
        <div className="help__head-actions">
          <button
            type="button"
            className="help__drawer-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Оглавление"
            aria-expanded={sidebarOpen}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <NavMenu
            links={[
              { label: 'Judge', href: `${TRAINER_URL}help/judge/`, current: true, hint: 'Задачи из книг серии' },
              { label: 'Учебный режим', href: HELP_URL, hint: '~180 записей с тренажёром' },
              { label: 'Полный СП', href: `${TRAINER_URL}help/full/`, hint: 'Все ~20 тыс. записей платформы' },
              { label: 'События 1С', href: `${TRAINER_URL}help/events/`, hint: '670 событий + lifecycle' },
              { label: '← Тренажёр', href: TRAINER_URL, hint: 'Писать и отлаживать BSL' },
            ]}
          />
        </div>
      </header>

      <main className={'help__body' + (sidebarOpen ? ' help__body--drawer-open' : '')}>
        {sidebarOpen && (
          <div className="help__backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        )}
        <section className="help__content judge__content">
          {indexError && (
            <div className="help__missing">
              <h1>Не удалось загрузить каталог задач</h1>
              <p>{indexError}</p>
            </div>
          )}
          {!index && !indexError && (
            <Loader title="Загружаю каталог задач" progress={null} />
          )}
          {index && route.kind === 'home' && <Home index={index} progress={progress} />}
          {index && route.kind === 'task' && (
            <TaskPageRoute
              bookId={route.bookId}
              taskId={route.taskId}
              index={index}
              progress={progress}
              onPassed={handlePassed}
              onDraft={handleDraft}
            />
          )}
          {index && route.kind === 'not-found' && (
            <div className="help__missing">
              <h1>Адрес не распознан</h1>
              <p>
                Не понял <code>{route.raw}</code>. Формат: <code>#/task/&lt;book_id&gt;/&lt;task_id&gt;</code>.
              </p>
              <p><a href="#/">На главную Judge</a></p>
            </div>
          )}
        </section>
        {index && <Sidebar index={index} progress={progress} route={route} />}
      </main>

      <HelpFooter hint={
        index
          ? `Judge · ${index.books.reduce((s, b) => s + b.taskCount, 0)} задач из ${index.books.length} ${index.books.length === 1 ? 'книги' : 'книг'} · прогонка тестов через тот же интерпретатор`
          : 'Judge · задачи из книг серии'
      } />

      <PwaBanners />
    </div>
    </ToastHost>
  );
}

function TaskPageRoute({
  bookId,
  taskId,
  index,
  progress,
  onPassed,
  onDraft,
}: {
  bookId: string;
  taskId: string;
  index: JudgeIndex;
  progress: ProgressMap;
  onPassed: (bookId: string, taskId: string, solution: string) => void;
  onDraft: (bookId: string, taskId: string, solution: string) => void;
}) {
  const [file, setFile] = useState<TasksFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setFile(null);
    setLoadError(null);
    loadBookTasks(bookId)
      .then((f) => alive && setFile(f))
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [bookId]);

  const bookMeta = index.books.find((b) => b.id === bookId);
  if (!bookMeta) {
    return (
      <div className="help__missing">
        <h1>Книга не найдена</h1>
        <p>В каталоге нет книги с id <code>{bookId}</code>.</p>
        <p><a href="#/">На главную Judge</a></p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="help__missing">
        <h1>Не удалось загрузить задачи книги</h1>
        <p>{loadError}</p>
      </div>
    );
  }
  if (!file) return <Loader title="Загружаю задачи книги" progress={null} />;

  const task = findTask(file, taskId);
  if (!task) {
    return (
      <div className="help__missing">
        <h1>Задача не найдена</h1>
        <p>В книге <b>{bookMeta.title}</b> нет задачи <code>{taskId}</code>.</p>
        <p><a href="#/">На главную Judge</a></p>
      </div>
    );
  }

  const prev = getProgress(progress, bookId, taskId);
  return (
    <TaskPage
      task={task}
      book={bookMeta}
      initialSolution={prev?.solution ?? task.starter}
      passedAt={prev?.passedAt ?? 0}
      onPassed={(sol) => onPassed(bookId, taskId, sol)}
      onDraft={(sol) => onDraft(bookId, taskId, sol)}
      runner={runTask}
    />
  );
}

function Sidebar({
  index,
  progress,
  route,
}: {
  index: JudgeIndex;
  progress: ProgressMap;
  route: Route;
}) {
  const activeBookId = route.kind === 'task' ? route.bookId : null;
  const activeTaskId = route.kind === 'task' ? route.taskId : null;

  // Задачи каждой книги — если книга открыта, показываем краткий список.
  // Полный текст лежит в отдельном JSON и подгружается lazy; в sidebar
  // показываем только счётчики + при активной книге — список задач,
  // если он уже загружен через TaskPageRoute.
  return (
    <nav className="sb" aria-label="Каталог задач">
      <a className={'sb__home' + (route.kind === 'home' ? ' sb__home--active' : '')} href="#/">
        Главная
      </a>
      {index.books.map((b) => {
        const passedInBook = countPassed(progress, b.id, b.taskCount);
        return (
          <div key={b.id} className="sb__section">
            <div className="sb__sectionTitle">
              {b.title}
              <span className="judge__badge">{passedInBook.done}/{passedInBook.total}</span>
            </div>
            <BookTaskList
              bookId={b.id}
              activeTaskId={activeBookId === b.id ? activeTaskId : null}
              progress={progress}
            />
          </div>
        );
      })}
    </nav>
  );
}

function BookTaskList({
  bookId,
  activeTaskId,
  progress,
}: {
  bookId: string;
  activeTaskId: string | null;
  progress: ProgressMap;
}) {
  const [file, setFile] = useState<TasksFile | null>(null);
  useEffect(() => {
    let alive = true;
    loadBookTasks(bookId)
      .then((f) => alive && setFile(f))
      .catch(() => { /* тихо: если не грузится, sidebar пустой, ошибка видна на main */ });
    return () => { alive = false; };
  }, [bookId]);

  if (!file) return <ul className="sb__list judge__sb-loading">Загрузка…</ul>;

  const grouped = groupByChapter(file.tasks);
  return (
    <ul className="sb__list">
      {grouped.map(([chapter, tasks]) => (
        <li key={chapter} className="sb__group">
          <div className="sb__groupHead">
            <span className="sb__groupName">{chapter}</span>
            <span className="sb__groupCount">{tasks.length}</span>
          </div>
          <ul className="sb__list">
            {tasks.map((t) => {
              const p = getProgress(progress, bookId, t.id);
              const passed = p !== null && p.passedAt > 0;
              return (
                <li key={t.id}>
                  <a
                    href={`#/task/${encodeURIComponent(bookId)}/${encodeURIComponent(t.id)}`}
                    className={
                      'sb__entry' +
                      (activeTaskId === t.id ? ' sb__entry--active' : '') +
                      (passed ? ' judge__task--passed' : '')
                    }
                  >
                    <span className="judge__task-mark" aria-hidden="true">{passed ? '✓' : '○'}</span>
                    <span>{t.title}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function groupByChapter(tasks: Task[]): [string, Task[]][] {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const arr = map.get(t.chapter);
    if (arr) arr.push(t);
    else map.set(t.chapter, [t]);
  }
  return [...map.entries()];
}

function countPassed(progress: ProgressMap, bookId: string, total: number): { done: number; total: number } {
  let done = 0;
  const prefix = `${bookId}:`;
  for (const [k, v] of Object.entries(progress)) {
    if (k.startsWith(prefix) && v.passedAt > 0) done += 1;
  }
  return { done, total };
}

export type { Route, TaskResult };
