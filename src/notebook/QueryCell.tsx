/**
 * Query-ячейка ноутбука (#42).
 *
 * Устроена так же, как CodeCell — gutter слева с ▶, редактор посередине,
 * блок вывода снизу. Отличия:
 *   - язык sdbl вместо bsl (см. src/query-app/monaco-lang.ts);
 *   - результат — таблица (ResultTable), а не текстовый лог;
 *   - схема и данные (YAML) живут в самой ячейке; парсим и строим Fixture
 *     при каждом изменении — учебные объёмы, кэш излишен;
 *   - при ошибке в схеме/данных ячейка честно сообщает: «схема сломана»
 *     вместо тихого падения запроса.
 */
import { useMemo, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { BeforeMount } from '@monaco-editor/react';
import { registerSdblLanguage, SDBL_LANGUAGE_ID, SDBL_THEME_ID } from '../query-app/monaco-lang';
import { registerSdblProviders } from '../query-app/monaco-providers';
import { ResultTable } from '../query-app/ResultTable';
import { ParametersPanel } from '../query-app/ParametersPanel';
import { buildFixture, type Fixture } from '../query/fixture';
import { parseDataYaml, parseSchemaYaml, validateFixture } from '../query/schema-loader';
import { runQuery, type Rowset, type RunError } from '../query/interpreter';
import { toBslValue, type QueryParamEntry } from '../query/parameters';
import type { BslValue } from '@core/index';

interface QueryCellProps {
  source: string;
  schema: string;
  data: string;
  onChange: (next: string) => void;
  parameters?: QueryParamEntry[];
  onParametersChange?: (next: QueryParamEntry[]) => void;
  /** Просмотр решения (#32): Monaco read-only, кнопка ▶ доступна. */
  readOnly?: boolean;
  /** Ссылка на пару .schema/.data.yaml в репо педагога — только для badge. */
  ref?: string;
  /**
   * Педагог задал `ref`, но контекст `?nb-src=` не подключён (открыто из
   * `?nb=` или draft'а). Показываем placeholder — ученик поймёт, что нужно
   * открыть по ссылке педагога, чтобы забрать свежую схему.
   */
  showRefPlaceholder?: boolean;
}

type FixtureLoad =
  | { ok: true; fixture: Fixture }
  | { ok: false; message: string };

export function QueryCell({ source, schema, data, onChange, parameters, onParametersChange, readOnly, ref, showRefPlaceholder }: QueryCellProps) {
  const load = useMemo<FixtureLoad>(() => tryLoadFixture(schema, data), [schema, data]);
  const [rowset, setRowset] = useState<Rowset | null>(null);
  const [errors, setErrors] = useState<RunError[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const handleBeforeMount: BeforeMount = (monaco) => {
    registerSdblLanguage(monaco);
    if (load.ok) registerSdblProviders(monaco, load.fixture.schema);
  };

  const handleRun = (): void => {
    if (!load.ok) return;
    setRunning(true);
    Promise.resolve().then(() => {
      const paramMap: { [name: string]: BslValue } = {};
      for (const p of parameters ?? []) paramMap[p.name] = toBslValue(p.value);
      const r = runQuery(source, load.fixture, { parameters: paramMap });
      if (r.ok) {
        setRowset(r.rowset);
        setErrors([]);
        setWarnings(r.warnings);
      } else {
        setRowset(null);
        setErrors(r.errors);
        setWarnings([]);
      }
      setRunning(false);
    });
  };

  const lineCount = Math.max(3, Math.min(20, source.split('\n').length));
  const editorHeight = lineCount * 22 + 12;

  return (
    <div className="nb-cell nb-cell--query">
      <div className="nb-cell__gutter">
        <button
          type="button"
          className="nb-cell__run"
          onClick={handleRun}
          disabled={running || !load.ok}
          title={load.ok ? 'Выполнить запрос' : 'Схема или данные ячейки повреждены'}
          aria-label="Выполнить запрос"
        >
          ▶
        </button>
        <div className="nb-cell__run-index" title="1С Запрос">📊</div>
      </div>
      <div className="nb-cell__body">
        {showRefPlaceholder && ref && (
          <div className="nb-cell__ref-placeholder">
            🔗 Схема из репо педагога: <code>{ref}</code>. Открой урок по ссылке от педагога, чтобы подтянуть свежие данные.
          </div>
        )}
        {!load.ok && (
          <div className="nb-cell__ref-placeholder nb-cell__ref-placeholder--error">
            ⚠ {load.message}
          </div>
        )}
        {load.ok && (
          <div className="nb-cell__query-hint" title="Доступные таблицы этой ячейки">
            📚 {summarizeSchema(load.fixture)}
          </div>
        )}
        <div className="nb-cell__editor" style={{ height: editorHeight }}>
          <MonacoEditor
            height="100%"
            defaultLanguage={SDBL_LANGUAGE_ID}
            theme={SDBL_THEME_ID}
            value={source}
            onChange={(next) => onChange(next ?? '')}
            beforeMount={handleBeforeMount}
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              tabSize: 4,
              lineNumbers: 'on',
              lineNumbersMinChars: 2,
              lineDecorationsWidth: 4,
              glyphMargin: false,
              folding: false,
              renderWhitespace: 'selection',
              automaticLayout: true,
              scrollbar: { alwaysConsumeMouseWheel: false },
              readOnly: !!readOnly,
            }}
          />
        </div>
        {load.ok && onParametersChange && (
          <ParametersPanel
            source={source}
            entries={parameters ?? []}
            onChange={onParametersChange}
            fixture={load.fixture}
          />
        )}
        {(rowset || errors.length > 0) && load.ok && (
          <div className="nb-cell__query-result">
            <ResultTable rowset={rowset} errors={errors} warnings={warnings} fixture={load.fixture} />
          </div>
        )}
      </div>
    </div>
  );
}

function tryLoadFixture(schema: string, data: string): FixtureLoad {
  const s = parseSchemaYaml(schema);
  if (!s.ok) return { ok: false, message: `Схема ячейки: ${s.error}` };
  const d = parseDataYaml(data);
  if (!d.ok) return { ok: false, message: `Данные ячейки: ${d.error}` };
  const v = validateFixture(s.value, d.value);
  if (!v.ok) return { ok: false, message: `Данные не совпадают со схемой: ${v.error}` };
  return { ok: true, fixture: buildFixture(s.value, d.value) };
}

function summarizeSchema(fx: Fixture): string {
  const byKind = new Map<string, string[]>();
  for (const t of fx.schema.tables) {
    const arr = byKind.get(t.kind) ?? [];
    arr.push(t.name);
    byKind.set(t.kind, arr);
  }
  const parts: string[] = [];
  for (const [kind, names] of byKind) {
    parts.push(`${kind}: ${names.join(', ')}`);
  }
  return parts.join(' · ');
}
