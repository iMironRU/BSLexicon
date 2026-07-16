import type { GitConfig } from '../git-config';

interface GitStatusBadgeProps {
  cfg: GitConfig | null;
  onClick: () => void;
}

/**
 * Компактный индикатор в шапке тренажёра — показывает, подключён ли
 * репо. Клик всегда открывает модалку настроек.
 */
export function GitStatusBadge({ cfg, onClick }: GitStatusBadgeProps) {
  if (cfg === null) {
    return (
      <button
        type="button"
        className="git-badge git-badge--off"
        onClick={onClick}
        title="Подключить GitHub-репозиторий для синхронизации сниппетов"
      >
        <span aria-hidden="true">🔗</span>
        <span className="btn-label">Git</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="git-badge git-badge--on"
      onClick={onClick}
      title={`Подключено к ${cfg.owner}/${cfg.repo} (ветка ${cfg.branch}). Клик — настройки.`}
    >
      <span aria-hidden="true">✓</span>
      <span className="git-badge__repo">{cfg.owner}/{cfg.repo}</span>
    </button>
  );
}
