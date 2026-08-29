import { useEffect, useState } from 'react';

/**
 * Отслеживает `navigator.onLine`. При отсутствии сети возвращает `false`,
 * иначе `true`. При SSR (нет `navigator`) считаем `true` — оптимистичный
 * дефолт, флаг сработает после гидрации, если реально оффлайн.
 *
 * Используется в футерах, чтобы показать точку «работаешь без сети —
 * PWA-кэш покрывает». Не блокирует UI, чисто индикация.
 *
 * Замечание про надёжность: `navigator.onLine` умеет врать (Wi-Fi
 * подключён, но интернета нет). Для «true offline» нужен реальный
 * heartbeat, но для нашей задачи (успокоить читателя, что мы работаем
 * из кэша) собственных heartbeat'ов не требуется.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const onOnline = (): void => setOnline(true);
    const onOffline = (): void => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return online;
}
