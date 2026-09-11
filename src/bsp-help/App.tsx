import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../app/error-message';
import type { BspHooksJson, BspModule, BspProcedure, BspSubsystem } from './types';
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

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}reference/bsp-hooks.json`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<BspHooksJson>;
      })
      .then((json) => {
        setData(json);
        // Preselect: первая подсистема → первый модуль → первая процедура.
        const s = json.subsystems[0];
        const m = s?.modules[0];
        const p = m?.procedures[0];
        if (s && m && p) setSel({ subsystem: s.name, module: m.name, procedure: p.name });
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const active = useMemo(() => findActive(data, sel), [data, sel]);

  if (error) return <div className="bsp-shell"><p className="bsp-error">Не удалось загрузить bsp-hooks.json: {error}</p></div>;
  if (!data) return <div className="bsp-shell"><p className="bsp-loading">Загружаю каталог хуков…</p></div>;

  return (
    <div className="bsp-shell">
      <header className="bsp-header">
        <a href={`${import.meta.env.BASE_URL}`} className="bsp-home">← BSLexicon</a>
        <h1>Хуки БСП <span className="bsp-version">{data.bspVersion}</span></h1>
        <a href={`${import.meta.env.BASE_URL}help/`} className="bsp-help-link">/help/</a>
      </header>

      <AttributionBanner data={data} />

      <div className="bsp-body">
        <aside className="bsp-sidebar">
          {data.subsystems.map((s) => (
            <SubsystemNode
              key={s.name}
              subsystem={s}
              sel={sel}
              onSelect={setSel}
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
  onSelect: (s: Selection) => void;
}

function SubsystemNode({ subsystem, sel, onSelect }: NodeProps): JSX.Element {
  const expanded = sel?.subsystem === subsystem.name;
  return (
    <details open={expanded} className="bsp-sub">
      <summary>{subsystem.name}</summary>
      {subsystem.modules.map((m) => (
        <ModuleNode key={m.name} subsystem={subsystem} module={m} sel={sel} onSelect={onSelect} />
      ))}
    </details>
  );
}

function ModuleNode({ subsystem, module, sel, onSelect }: NodeProps & { module: BspModule }): JSX.Element {
  const expanded = sel?.subsystem === subsystem.name && sel.module === module.name;
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

      <p className="bsp-card__attribution">
        Фрагмент шапки процедуры из модуля <code>{mod.name}</code>, БСП. {license.holder}, лицензия{' '}
        <a href={license.url} target="_blank" rel="noreferrer">{license.spdx}</a>. Приведён в сокращении.
      </p>
    </article>
  );
}

function firstParagraph(text: string): string {
  // До первой пустой строки или до секции «Параметры:» — на карточке
  // Фазы A показываем только summary, полный docstring остаётся в JSON.
  const cutParams = text.split(/\n\s*Параметры:\s*\n/)[0];
  const cutBlank = cutParams.split(/\n\s*\n/)[0];
  return cutBlank.trim();
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
