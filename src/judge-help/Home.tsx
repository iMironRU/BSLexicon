import type { JudgeIndex, BookIndexEntry } from './loader';
import type { ProgressMap } from './progress';

interface HomeProps {
  index: JudgeIndex;
  progress: ProgressMap;
}

export function Home({ index, progress }: HomeProps) {
  const totalTasks = index.books.reduce((s, b) => s + b.taskCount, 0);
  const passedTotal = countPassed(progress);

  return (
    <div className="judge__home">
      <h1 className="judge__title">Задачи Judge</h1>
      <p className="judge__lead">
        Задачи по языку 1С из авторских книг серии. Условие, редактор,
        автопрогонка тестов через тот же интерпретатор, что и в
        тренажёре — что здесь зелёное, будет зелёным и там.
      </p>

      {index.books.length === 0 && (
        <div className="judge__empty">
          <p>Пока ни одна книга не подключена к тренажёру. Появятся здесь после первого релиза с <code>tasks.json</code>.</p>
        </div>
      )}

      <div className="judge__stats">
        <span>
          <b>{passedTotal}</b> из <b>{totalTasks}</b> задач пройдено
        </span>
        <span className="judge__stats-books">· {index.books.length} {index.books.length === 1 ? 'книга' : 'книг'}</span>
      </div>

      <ul className="judge__books">
        {index.books.map((b) => (
          <li key={b.id}>
            <BookCard book={b} progress={progress} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BookCard({ book, progress }: { book: BookIndexEntry; progress: ProgressMap }) {
  const passed = countPassed(progress, book.id);
  return (
    <div className="judge__book">
      <div className="judge__book-header">
        <div>
          <h2 className="judge__book-title">{book.title}</h2>
          <div className="judge__book-meta">
            v{book.version} · {book.taskCount} задач · <a href={book.site} target="_blank" rel="noopener noreferrer">открыть книгу ↗</a>
          </div>
        </div>
        <div className="judge__book-progress">
          <b>{passed}</b> / {book.taskCount}
        </div>
      </div>
      <p className="judge__book-hint">
        Задачи книги в сайдбаре справа — открой оглавление и выбирай.
      </p>
    </div>
  );
}

function countPassed(progress: ProgressMap, bookId?: string): number {
  let n = 0;
  const prefix = bookId ? `${bookId}:` : null;
  for (const [k, v] of Object.entries(progress)) {
    if (v.passedAt <= 0) continue;
    if (prefix === null || k.startsWith(prefix)) n += 1;
  }
  return n;
}
