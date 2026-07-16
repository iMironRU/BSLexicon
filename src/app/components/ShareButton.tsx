import { useEffect, useState } from 'react';
import { encodeCodeParam } from '../url-params';

interface ShareButtonProps {
  /** Текущий код редактора — из него формируется ?code=… */
  code: string;
}

type FlashState = 'idle' | 'copied' | 'error';

/**
 * Кнопка «🔗 Поделиться» — копирует ссылку на текущий код в буфер обмена.
 * Формат ссылки — тот же `?code=<base64>`, что используется во всех
 * «▶ В тренажёре» на карточках справочника, так что механика полностью
 * симметричная share ↔ open.
 *
 * Если navigator.clipboard недоступен (старый браузер, http-контекст) —
 * fallback: prompt со ссылкой, пользователь копирует руками.
 */
export function ShareButton({ code }: ShareButtonProps) {
  const [flash, setFlash] = useState<FlashState>('idle');

  useEffect(() => {
    if (flash === 'idle') return undefined;
    const id = window.setTimeout(() => setFlash('idle'), 2000);
    return () => window.clearTimeout(id);
  }, [flash]);

  const handleClick = async (): Promise<void> => {
    const url =
      window.location.origin +
      import.meta.env.BASE_URL +
      '?code=' +
      encodeCodeParam(code);

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        setFlash('copied');
        return;
      } catch {
        // упало (denied, insecure context) — уходим в fallback
      }
    }
    // Fallback: prompt показывает ссылку, пользователь сам Cmd+C
    window.prompt('Скопируй ссылку:', url);
    setFlash('idle');
  };

  const label =
    flash === 'copied' ? 'Скопировано ✓' :
    flash === 'error'  ? 'Ошибка'         :
    'Поделиться';
  const icon = flash === 'copied' ? '✓' : '🔗';

  return (
    <button
      type="button"
      className={'app__step share-btn' + (flash === 'copied' ? ' share-btn--ok' : '')}
      onClick={handleClick}
      title="Скопировать ссылку на текущий код"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="btn-label">{label}</span>
    </button>
  );
}
