/**
 * Общий toast — плашка в углу экрана, независимая от popover'ов.
 *
 * Использование:
 *
 *   const toast = useToast();
 *   toast.show('Скопировано');
 *   toast.show('Не удалось загрузить', 'error');
 *
 * Провайдер `<ToastHost>...</ToastHost>` ставится в корне каждого entry-point.
 * Тосты — очередь, показываются 3 секунды, dismiss по клику. Одинаковые
 * подряд не дублируются (dedup по message+kind).
 *
 * Context и хук `useToast` вынесены в `./context.ts`, чтобы этот файл
 * содержал только React-компоненты — иначе Vite Fast Refresh не может
 * hot-обновлять модуль (mixing component + non-component export).
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastContext, type ToastApi } from './context';
import './toast.css';

interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error' | 'info';
}

const DURATION_MS = 3000;

let idCounter = 0;
function nextId(): number {
  idCounter += 1;
  return idCounter;
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number): void => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>((message, kind = 'ok') => {
    // ID генерируем ДО setState, а сам setState — pure (использует
    // только captured id). StrictMode dev-mode вызывает функциональные
    // сеттеры дважды для проверки purity; если внутри Date.now(), два
    // вызова дадут разные результаты и React может обнулить их — тост
    // не отрендерится, как будто ничего не было.
    const id = nextId();
    setToasts((cur) => {
      const last = cur[cur.length - 1];
      if (last && last.message === message && last.kind === kind) return cur;
      return [...cur, { id, message, kind }];
    });
  }, []);

  const api: ToastApi = { show };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // TTL — ref, чтобы обновление onDismiss (новая функция каждый render)
  // не пересоздавало setTimeout заново. Иначе в StrictMode/HMR тост
  // может исчезать раньше 3с из-за постоянных cleanup+reset.
  useEffect(() => {
    const id = window.setTimeout(onDismiss, DURATION_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const prefix =
    toast.kind === 'error' ? '✗ ' :
    toast.kind === 'info' ? 'ℹ ' :
    '✓ ';

  return (
    <button
      type="button"
      className={`toast toast--${toast.kind}`}
      onClick={onDismiss}
      title="Скрыть"
    >
      <span className="toast__prefix" aria-hidden="true">{prefix}</span>
      <span className="toast__text">{toast.message}</span>
    </button>
  );
}
