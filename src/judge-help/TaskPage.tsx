import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Task, TaskResult } from '../judge/types';
import type { BookIndexEntry } from './loader';

interface TaskPageProps {
  task: Task;
  book: BookIndexEntry;
  initialSolution: string;
  /** Unix-ms когда задача была пройдена ранее (0 = ещё нет). */
  passedAt: number;
  onPassed: (solution: string) => void;
  onDraft: (solution: string) => void;
  /** Прогонка тестов — прокидывается из App для тестируемости. */
  runner: (task: Task, code: string) => TaskResult;
}

export function TaskPage({
  task,
  book,
  initialSolution,
  passedAt,
  onPassed,
  onDraft,
  runner,
}: TaskPageProps) {
  const [source, setSource] = useState(initialSolution);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [expandedHints, setExpandedHints] = useState<Set<number>>(() => new Set());

  // При переключении задачи (только при смене task.id) — сбрасываем
  // локальное состояние. НЕ вешаемся на initialSolution: он меняется
  // родителем после успешной проверки (сохранённое решение),
  // это не «новая задача» — иначе result мигнёт и пропадёт.
  useEffect(() => {
    setSource(initialSolution);
    setResult(null);
    setExpandedHints(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Автосохранение черновика с дебаунсом 500 мс.
  useEffect(() => {
    const id = window.setTimeout(() => onDraft(source), 500);
    return () => window.clearTimeout(id);
  }, [source, onDraft]);

  const handleCheck = useCallback((): void => {
    const r = runner(task, source);
    setResult(r);
    if (r.overall === 'pass') onPassed(source);
  }, [runner, task, source, onPassed]);

  const handleReset = (): void => {
    if (source === task.starter) return;
    if (!window.confirm('Сбросить решение к стартовому коду? Твой текущий код потеряется.')) return;
    setSource(task.starter);
    setResult(null);
  };

  const trainerUrl = `${import.meta.env.BASE_URL}?code=${encodeCodeParam(source)}&title=${encodeURIComponent(`${book.title} — ${task.title}`)}`;

  return (
    <article className="judge__task">
      <div className="judge__task-crumbs">
        <a href="#/">Все задачи</a>
        <span> / </span>
        <span>{book.title}</span>
        <span> / </span>
        <span>{task.chapter}</span>
      </div>

      <h1 className="judge__task-title">
        {task.title}
        {passedAt > 0 && <span className="judge__passed-badge" title={`Пройдено ${new Date(passedAt).toLocaleDateString('ru')}`}>✓ пройдено</span>}
      </h1>

      <div className="judge__task-meta">
        {task.section && <span>§ {task.section}</span>}
        {task.difficulty && <span className="judge__diff">{difficultyLabel(task.difficulty)}</span>}
        {task.tags && task.tags.length > 0 && (
          <span className="judge__tags">
            {task.tags.map((t) => <span key={t} className="judge__tag">{t}</span>)}
          </span>
        )}
      </div>

      <section className="judge__statement">
        {renderMarkdown(task.statement)}
      </section>

      {task.book_url && (
        <a href={task.book_url} target="_blank" rel="noopener noreferrer" className="judge__book-link">
          📖 Разбор в книге ↗
        </a>
      )}

      <section className="judge__editor-section">
        <div className="judge__editor-header">
          <h2>Решение</h2>
          <div className="judge__editor-actions">
            <button type="button" className="judge__btn judge__btn--secondary" onClick={handleReset}>
              ↺ Сброс
            </button>
            <a
              href={trainerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="judge__btn judge__btn--secondary"
              title="Открыть код в полноценном тренажёре (со степ-отладкой)"
            >
              ▶ В тренажёре ↗
            </a>
            <button type="button" className="judge__btn judge__btn--primary" onClick={handleCheck}>
              ✓ Проверить
            </button>
          </div>
        </div>
        <textarea
          className="judge__code"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          rows={Math.max(8, source.split('\n').length + 2)}
        />
      </section>

      {result && <TestResults result={result} />}

      {task.hints && task.hints.length > 0 && (
        <section className="judge__hints">
          <h2>Подсказки</h2>
          {task.hints.map((h, i) => (
            <details
              key={i}
              open={expandedHints.has(i)}
              onToggle={(e) => {
                const next = new Set(expandedHints);
                if ((e.target as HTMLDetailsElement).open) next.add(i);
                else next.delete(i);
                setExpandedHints(next);
              }}
            >
              <summary>Подсказка {i + 1}</summary>
              <p>{h}</p>
            </details>
          ))}
        </section>
      )}
    </article>
  );
}

function TestResults({ result }: { result: TaskResult }) {
  const label =
    result.overall === 'pass' ? '✓ Все тесты зелёные — задача пройдена!' :
    result.overall === 'error' ? '⚠ Ошибка при прогонке' :
    '✗ Не все тесты зелёные';

  return (
    <section className={`judge__results judge__results--${result.overall}`}>
      <h2>{label}</h2>
      <ol className="judge__test-list">
        {result.tests.map((t, i) => (
          <li key={i} className={`judge__test judge__test--${t.status}`}>
            <div className="judge__test-head">
              <span className="judge__test-mark" aria-hidden="true">
                {t.status === 'pass' ? '✓' : t.status === 'fail' ? '✗' : '⚠'}
              </span>
              <span className="judge__test-name">
                {t.hidden ? `Скрытый тест ${i + 1}` : (t.name ?? `Тест ${i + 1}`)}
              </span>
            </div>
            {!t.hidden && t.status !== 'pass' && (
              <div className="judge__test-detail">
                {t.error && <div className="judge__test-error">{t.error}</div>}
                {!t.error && t.expected !== undefined && (
                  <>
                    <div><b>Ожидалось:</b> <pre>{t.expected}</pre></div>
                    <div><b>Получилось:</b> <pre>{t.actual ?? '(пусто)'}</pre></div>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Минимальный markdown: `**bold**`, backtick-code, простые списки и абзацы. */
function renderMarkdown(text: string): ReactNode {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((p, i) => {
    if (p.startsWith('- ')) {
      const items = p.split('\n').map((l) => l.replace(/^-\s+/, ''));
      return <ul key={i}>{items.map((li, j) => <li key={j}>{renderInline(li)}</li>)}</ul>;
    }
    return <p key={i}>{renderInline(p)}</p>;
  });
}

function renderInline(text: string): ReactNode {
  // Разбиваем по `code` и **bold**. Никакого HTML — только текст.
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const chunk = m[0];
    if (chunk.startsWith('`')) {
      parts.push(<code key={`c${i}`}>{chunk.slice(1, -1)}</code>);
    } else {
      parts.push(<b key={`b${i}`}>{chunk.slice(2, -2)}</b>);
    }
    last = m.index + chunk.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function difficultyLabel(d: string): string {
  switch (d) {
    case 'intro': return 'вступление';
    case 'easy': return 'легко';
    case 'medium': return 'средне';
    case 'hard': return 'сложно';
    default: return d;
  }
}

/** Копия encodeCodeParam из src/app/url-params — не тянем весь модуль
 *  ради одной функции. */
function encodeCodeParam(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
