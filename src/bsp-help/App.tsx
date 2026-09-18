import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../app/error-message';
import { BASE_URL, HELP_URL, LANDING_URL } from '../app/urls';
import type { BspHooksJson, BspModule, BspParam, BspProcedure, BspSubsystem } from './types';
import { HelpFooter } from '../help/HelpFooter';

interface Selection {
  subsystem: string;
  module: string;
  procedure: string;
}

export function App(): JSX.Element {
  const [data, setData] = useState<BspHooksJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const url = `${BASE_URL}reference/bsp-hooks.json`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<BspHooksJson>;
      })
      .then((json) => {
        setData(json);
        // Deep-link из hash приоритетнее дефолта — читатель пришёл по ссылке.
        const fromHash = parseHash(window.location.hash);
        const initial = fromHash && findActive(json, fromHash) ? fromHash : defaultSelection(json);
        if (initial) {
          setSel(initial);
          writeHash(initial);
        }
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  // Кнопка «Назад» браузера — hash уже поменялся, синхронизируем sel.
  useEffect(() => {
    if (!data) return;
    const onChange = (): void => {
      const s = parseHash(window.location.hash);
      if (s && findActive(data, s)) setSel(s);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [data]);

  const handleSelect = (s: Selection): void => {
    setSel(s);
    writeHash(s);
  };

  const active = useMemo(() => findActive(data, sel), [data, sel]);

  if (error) return <div className="bsp-shell"><p className="bsp-error">Не удалось загрузить bsp-hooks.json: {error}</p></div>;
  if (!data) return <div className="bsp-shell"><p className="bsp-loading">Загружаю каталог хуков…</p></div>;

  return (
    <div className="bsp-shell">
      <header className="bsp-header">
        <a href={LANDING_URL} className="bsp-home">← BSLexicon</a>
        <h1>Хуки БСП <span className="bsp-version">{data.bspVersion}</span></h1>
        <a href={HELP_URL} className="bsp-help-link">/help/</a>
      </header>

      <AttributionBanner data={data} />

      <div className="bsp-body">
        <aside className="bsp-sidebar">
          <input
            type="search"
            className="bsp-sidebar__filter"
            placeholder="Поиск по процедурам…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filterSubsystems(data.subsystems, filter).map((s) => (
            <SubsystemNode
              key={s.name}
              subsystem={s}
              sel={sel}
              forceOpen={filter !== ''}
              onSelect={handleSelect}
            />
          ))}
        </aside>

        <main className="bsp-main">
          {active ? (
            <ProcedureCard sub={active.subsystem} mod={active.module} proc={active.procedure} license={data.license} />
          ) : (
            <p className="bsp-loading">Выберите процедуру слева.</p>
          )}
        </main>
      </div>

      <HelpFooter />
    </div>
  );
}

function AttributionBanner({ data }: { data: BspHooksJson }): JSX.Element {
  return (
    <p className="bsp-attribution">
      Тексты из шапок процедур — Библиотека стандартных подсистем {data.bspVersion}, {data.license.holder}, лицензия{' '}
      <a href={data.license.url} target="_blank" rel="noreferrer">{data.license.spdx}</a>. Здесь показаны с
      возможными сокращениями и переформатированием.
    </p>
  );
}

interface NodeProps {
  subsystem: BspSubsystem;
  sel: Selection | null;
  /** При активном поиске раскрываем ветку, даже если она не в текущем sel. */
  forceOpen: boolean;
  onSelect: (s: Selection) => void;
}

function SubsystemNode({ subsystem, sel, forceOpen, onSelect }: NodeProps): JSX.Element {
  const expanded = forceOpen || sel?.subsystem === subsystem.name;
  return (
    <details open={expanded} className="bsp-sub">
      <summary>{subsystem.name}</summary>
      {subsystem.modules.map((m) => (
        <ModuleNode key={m.name} subsystem={subsystem} module={m} sel={sel} forceOpen={forceOpen} onSelect={onSelect} />
      ))}
    </details>
  );
}

function ModuleNode({ subsystem, module, sel, forceOpen, onSelect }: NodeProps & { module: BspModule }): JSX.Element {
  const expanded = forceOpen || (sel?.subsystem === subsystem.name && sel.module === module.name);
  return (
    <details open={expanded} className="bsp-mod">
      <summary>
        <span className={`bsp-side bsp-side--${module.side === 'Клиент' ? 'client' : 'server'}`}>{module.side}</span>
        {module.name}
      </summary>
      <ul className="bsp-proc-list">
        {module.procedures.map((p) => {
          const active = sel?.subsystem === subsystem.name && sel.module === module.name && sel.procedure === p.name;
          return (
            <li key={p.name}>
              <button
                type="button"
                className={'bsp-proc-btn' + (active ? ' bsp-proc-btn--active' : '')}
                onClick={() => onSelect({ subsystem: subsystem.name, module: module.name, procedure: p.name })}
              >
                {p.name}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ProcedureCard({ sub, mod, proc, license }: {
  sub: BspSubsystem;
  mod: BspModule;
  proc: BspProcedure;
  license: BspHooksJson['license'];
}): JSX.Element {
  return (
    <article className="bsp-card">
      <div className="bsp-card__crumbs">
        <span>{sub.name}</span> · <span>{mod.name}</span>
      </div>
      <h2 className="bsp-card__name">{proc.name}</h2>
      <pre className="bsp-card__signature"><code>{proc.signature}</code></pre>

      {proc.docstring && (
        <section className="bsp-card__section">
          <h3>Что делает</h3>
          <p className="bsp-card__docstring">{firstParagraph(proc.docstring)}</p>
        </section>
      )}

      {proc.params.some((p) => p.type || p.description || p.fields) && (
        <section className="bsp-card__section">
          <h3>Параметры</h3>
          <dl className="bsp-card__params">
            {proc.params.map((p) => (
              <ProcParam key={p.name} param={p} />
            ))}
          </dl>
        </section>
      )}

      {(() => {
        const example = extractExample(proc.docstring);
        return example ? (
          <section className="bsp-card__section">
            <h3>Пример</h3>
            <pre className="bsp-card__example"><code>{example}</code></pre>
          </section>
        ) : null;
      })()}

      <p className="bsp-card__attribution">
        Фрагмент шапки процедуры из модуля <code>{mod.name}</code>, БСП. {license.holder}, лицензия{' '}
        <a href={license.url} target="_blank" rel="noreferrer">{license.spdx}</a>. Приведён в сокращении.
      </p>
    </article>
  );
}

function ProcParam({ param }: { param: BspParam }): JSX.Element {
  return (
    <>
      <dt className="bsp-card__param-name">
        <code>{param.name}</code>
        {param.type && <span className="bsp-card__param-type">{cleanType(param.type)}</span>}
      </dt>
      <dd className="bsp-card__param-desc">
        {param.description || (!param.fields && <em>без описания в шапке</em>)}
        {param.fields && param.fields.length > 0 && (
          <ul className="bsp-card__fields">
            {param.fields.map((f) => (
              <li key={f.name} className="bsp-card__field">
                <code>{f.name}</code>
                {f.type && <span className="bsp-card__param-type"> · {cleanType(f.type)}</span>}
                {f.description && <span className="bsp-card__field-desc"> — {f.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </>
  );
}

/** Старые JSON могли сохранить тип с трейлингом `:` перед вложенными полями
 *  структуры. Скрипт `build-bsp-hooks.ts` теперь уже отрезает его; правило
 *  оставляем как страховку на случай пересборки со старым выходом. */
function cleanType(t: string): string {
  return t.replace(/:$/, '').trim();
}

function firstParagraph(text: string): string {
  // До первой пустой строки или до секции «Параметры:» — на карточке
  // Фазы A показываем только summary, полный docstring остаётся в JSON.
  const cutParams = text.split(/\n\s*Параметры:\s*\n/)[0];
  const cutBlank = cutParams.split(/\n\s*\n/)[0];
  // Жёсткие переносы шапки БСП по 120 символов — читателю не нужны,
  // склеиваем в один абзац, CSS сам расставит переносы по ширине.
  return cutBlank.replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * Вырезаем блок «Пример:» из шапки: строка «Пример:» на своей строке и всё
 * до конца docstring — примеры в БСП идут последней секцией. Если следующей
 * секции нет, но пример пустой, отдаём null. Общий лидирующий отступ (один
 * пробел или таб перед каждой строкой) снимаем — код читается ровнее.
 */
function extractExample(text: string): string | null {
  const m = text.match(/^Пример:\s*\n([\s\S]*)$/m);
  if (!m) return null;
  const body = m[1].replace(/\s+$/, '');
  if (!body) return null;
  const lines = body.split('\n');
  const nonBlank = lines.filter((l) => l.trim() !== '');
  const commonIndent = Math.min(
    ...nonBlank.map((l) => l.match(/^[ \t]*/)![0].length),
  );
  if (commonIndent > 0) {
    return lines.map((l) => l.slice(commonIndent)).join('\n');
  }
  return body;
}

function findActive(data: BspHooksJson | null, sel: Selection | null):
  | { subsystem: BspSubsystem; module: BspModule; procedure: BspProcedure }
  | null {
  if (!data || !sel) return null;
  const sub = data.subsystems.find((s) => s.name === sel.subsystem);
  const mod = sub?.modules.find((m) => m.name === sel.module);
  const proc = mod?.procedures.find((p) => p.name === sel.procedure);
  if (!sub || !mod || !proc) return null;
  return { subsystem: sub, module: mod, procedure: proc };
}

/**
 * Отфильтровать дерево подсистем по подстроке имени процедуры (регистро-
 * независимо). Модуль показываем, если в нём есть матч; подсистему — если
 * есть хотя бы один такой модуль. Пустой фильтр возвращает исходное дерево.
 */
function filterSubsystems(subsystems: readonly BspSubsystem[], query: string): BspSubsystem[] {
  const q = query.trim().toLowerCase();
  if (!q) return subsystems as BspSubsystem[];
  const out: BspSubsystem[] = [];
  for (const sub of subsystems) {
    const modules: BspModule[] = [];
    for (const mod of sub.modules) {
      const procedures = mod.procedures.filter((p) => p.name.toLowerCase().includes(q));
      if (procedures.length > 0) modules.push({ ...mod, procedures });
    }
    if (modules.length > 0) out.push({ ...sub, modules });
  }
  return out;
}

function defaultSelection(json: BspHooksJson): Selection | null {
  const s = json.subsystems[0];
  const m = s?.modules[0];
  const p = m?.procedures[0];
  return s && m && p ? { subsystem: s.name, module: m.name, procedure: p.name } : null;
}

/**
 * Deep-link контракт: `#<Подсистема>/<Модуль>/<Процедура>`, каждая часть
 * URL-энкодится по отдельности. `/` не встречается ни в подсистемах, ни в
 * модулях, ни в процедурах БСП, так что разделитель безопасный.
 */
function formatHash(sel: Selection): string {
  return '#' + [sel.subsystem, sel.module, sel.procedure].map(encodeURIComponent).join('/');
}

function parseHash(hash: string): Selection | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  const parts = raw.split('/');
  if (parts.length !== 3) return null;
  try {
    const [subsystem, module, procedure] = parts.map(decodeURIComponent);
    if (!subsystem || !module || !procedure) return null;
    return { subsystem, module, procedure };
  } catch {
    return null;
  }
}

/** Обновляем hash через replaceState — без записи в историю и без hashchange. */
function writeHash(sel: Selection): void {
  const h = formatHash(sel);
  if (window.location.hash !== h) {
    history.replaceState(null, '', h);
  }
}
