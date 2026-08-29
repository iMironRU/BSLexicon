import { useOnline } from '../app/useOnline';

const REPO_URL = 'https://github.com/iMironRU/BSLexicon';

interface HelpFooterProps {
  /** Подсказка о фичах страницы — левая половинка строки. */
  hint?: string;
}

/**
 * Статусная строка-футер для страниц справочника — единый стиль с
 * тренажёром (`app__footer`). Справа: индикатор сети (когда оффлайн),
 * ссылка на репо + SHA/время сборки, которые подставляет Vite через
 * `define`.
 */
export function HelpFooter({ hint }: HelpFooterProps) {
  const online = useOnline();
  return (
    <footer className="help__footer">
      {hint && <span className="help__footer-hint">{hint}</span>}
      <span className="help__footer-meta">
        {!online && (
          <span
            className="online-dot online-dot--offline"
            title="Работаешь без сети — PWA-кэш всё покрывает"
            aria-label="Оффлайн"
          >
            <span className="online-dot__mark" aria-hidden="true">●</span>
            <span className="online-dot__label">оффлайн</span>
          </span>
        )}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <span className="help__build" title={`Дата сборки: ${__BUILD_TIME__}`}>
          сборка {__BUILD_SHA__} · {__BUILD_TIME__}
        </span>
      </span>
    </footer>
  );
}
