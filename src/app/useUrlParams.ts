import { useEffect, useMemo, useState } from 'react';
import { decodeCodeParam, decompressGzip, parseSearchParams } from './url-params';

export interface UrlState {
  /**
   * null = нет параметра кода → показывать пример по умолчанию.
   * '' = ошибка декодирования → пустой редактор.
   * строка = успешно декодированный код.
   */
  code: string | null;
  /** Сообщение об ошибке или предупреждении (null = нет). */
  decodeError: string | null;
  /** true пока ?gzcode ещё декодируется асинхронно. */
  loading: boolean;
  /** Валидный http/https URL источника. */
  sourceUrl: string | null;
  /** Заголовок источника (?title). */
  title: string | null;
  /** Встроенный режим (?embed=1). */
  embed: boolean;
}

export function useUrlParams(): UrlState {
  const parsed = useMemo(() => parseSearchParams(window.location.search), []);

  const syncResult = useMemo(() => {
    if (parsed.gzcode !== null) return null; // gzcode приоритетнее
    if (!parsed.code) return null;
    return decodeCodeParam(parsed.code);
  }, [parsed.code, parsed.gzcode]);

  const [gzState, setGzState] = useState<{ code: string | null; error: string | null }>({
    code: null,
    error: null,
  });
  const [gzLoading, setGzLoading] = useState(parsed.gzcode !== null);

  useEffect(() => {
    if (!parsed.gzcode) return;
    let alive = true;
    decompressGzip(parsed.gzcode)
      .then((decoded) => {
        if (!alive) return;
        const oversized = decoded.length > 50 * 1024;
        setGzState({
          code: decoded,
          error: oversized ? 'Код в ссылке слишком большой, возможна порча данных' : null,
        });
        setGzLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setGzState({ code: '', error: 'Не удалось декодировать код из ссылки' });
        setGzLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [parsed.gzcode]);

  const base = { sourceUrl: parsed.sourceUrl, title: parsed.title, embed: parsed.embed };

  if (parsed.gzcode !== null) {
    return { ...base, code: gzState.code, decodeError: gzState.error, loading: gzLoading };
  }

  if (!syncResult) {
    return { ...base, code: null, decodeError: null, loading: false };
  }

  if (!syncResult.ok) {
    return { ...base, code: '', decodeError: syncResult.error, loading: false };
  }

  return {
    ...base,
    code: syncResult.code,
    decodeError: syncResult.oversized
      ? 'Код в ссылке слишком большой, возможна порча данных'
      : null,
    loading: false,
  };
}
