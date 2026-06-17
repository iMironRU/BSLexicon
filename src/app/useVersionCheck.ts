import { useEffect, useState } from 'react';

/**
 * Следит, не появилась ли на хостинге новая сборка (открытая вкладка могла не
 * перезагружаться). Сверяет вшитый `__BUILD_SHA__` с `version.json` на сервере;
 * проверяет при возврате фокуса на вкладку и раз в несколько минут.
 * Возвращает `true`, когда стоит предложить перезагрузку. В dev не активен.
 */
const CHECK_INTERVAL_MS = 3 * 60 * 1000;

export function useVersionCheck(): boolean {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let alive = true;

    const check = async (): Promise<void> => {
      try {
        const url = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { sha?: string };
        if (alive && data.sha && data.sha !== __BUILD_SHA__) setOutdated(true);
      } catch {
        // офлайн или файла нет — молча игнорируем
      }
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check();
    };

    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    void check();

    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return outdated;
}
