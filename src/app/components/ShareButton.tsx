import { encodeCodeParam } from '../url-params';
import { useToast } from '../toast/context';

interface ShareButtonProps {
  /** Текущий код редактора — из него формируется ?code=… */
  code: string;
}

/**
 * Кнопка «🔗 Поделиться» — копирует ссылку на текущий код в буфер обмена.
 * Формат ссылки — тот же `?code=<base64>`, что используется во всех
 * «▶ В тренажёре» на карточках справочника, так что механика полностью
 * симметричная share ↔ open.
 *
 * Результат показывается общим toast'ом (bottom-right) — виден
 * независимо от того, где сейчас курсор.
 *
 * Если navigator.clipboard недоступен (старый браузер, http-контекст) —
 * fallback: prompt со ссылкой, пользователь копирует руками.
 */
export function ShareButton({ code }: ShareButtonProps) {
  const toast = useToast();

  const handleClick = async (): Promise<void> => {
    const url =
      window.location.origin +
      import.meta.env.BASE_URL +
      '?code=' +
      encodeCodeParam(code);

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        toast.show('Ссылка скопирована');
        return;
      } catch {
        // упало (denied, insecure context) — уходим в fallback
      }
    }
    window.prompt('Скопируй ссылку:', url);
  };

  return (
    <button
      type="button"
      className="app__step share-btn"
      onClick={handleClick}
      title="Скопировать ссылку на текущий код"
    >
      <span aria-hidden="true">🔗</span>
      <span className="btn-label">Поделиться</span>
    </button>
  );
}
