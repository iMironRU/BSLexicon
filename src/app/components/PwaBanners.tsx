import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Регистрация Service Worker + два UX-баннера:
 *   • «Доступно обновление» — когда PWA-плагин увидел новую сборку
 *     (аналог нашего useVersionCheck, но со стороны service-worker).
 *   • «Установить приложение» — на мобиле после beforeinstallprompt
 *     от Chrome/Edge, iOS полагается на «Поделиться → На главный экран»
 *     (в Safari beforeinstallprompt нет — там подсказку сам показывает
 *     iOS через 3 дня в меню «Поделиться»).
 *
 * Ставится один раз в App — компонент сам ничего не рендерит, кроме
 * двух опциональных баннеров внизу экрана.
 */
export function PwaBanners() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, registration) => {
      // Раз в час проверяем — не появилась ли новая версия. Работает,
      // пока вкладка открыта; при новом визите Chrome сам делает update.
      if (registration) {
        setInterval(() => { void registration.update(); }, 60 * 60 * 1000);
      }
    },
  });

  const install = useInstallPrompt();

  return (
    <>
      {install.available && !install.dismissed && (
        <div className="pwa-banner pwa-banner--install" role="dialog">
          <span className="pwa-banner__icon" aria-hidden="true">📲</span>
          <span className="pwa-banner__text">
            Установи BSLexicon как приложение — иконка на экране, оффлайн-доступ.
          </span>
          <button type="button" className="pwa-banner__btn" onClick={install.prompt}>
            Установить
          </button>
          <button
            type="button"
            className="pwa-banner__close"
            onClick={install.dismiss}
            aria-label="Скрыть"
          >
            ✕
          </button>
        </div>
      )}

      {needRefresh && (
        <div className="pwa-banner pwa-banner--update" role="status">
          <span className="pwa-banner__icon" aria-hidden="true">✨</span>
          <span className="pwa-banner__text">Доступна новая версия BSLexicon.</span>
          <button
            type="button"
            className="pwa-banner__btn"
            onClick={() => { void updateServiceWorker(true); }}
          >
            Обновить
          </button>
          <button
            type="button"
            className="pwa-banner__close"
            onClick={() => setNeedRefresh(false)}
            aria-label="Позже"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = 'bslexicon:pwa:install-dismissed';

/**
 * Слушает `beforeinstallprompt` (только Chromium). Сам решает, когда
 * оффер актуален: если пользователь его отменил — скрываем на 30 дней.
 */
function useInstallPrompt(): {
  available: boolean;
  dismissed: boolean;
  prompt: () => Promise<void>;
  dismiss: () => void;
} {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => isRecentlyDismissed());

  useEffect(() => {
    const onPrompt = (e: Event): void => {
      e.preventDefault(); // не показываем родной баннер сразу — мы сами покажем
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => setEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return {
    available: event !== null,
    dismissed,
    prompt: async () => {
      if (!event) return;
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === 'dismissed') markDismissed();
      setEvent(null);
    },
    dismiss: () => {
      markDismissed();
      setDismissed(true);
    },
  };
}

function isRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < 30 * 24 * 60 * 60 * 1000; // 30 дней
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}
