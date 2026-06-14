/**
 * Провайдер автодополнения Monaco на основе каталога языка.
 *
 * Первый срез синтакс-помощника: после точки предлагаем методы типов, иначе —
 * глобальные функции. Контекст «после точки» определяем по тексту строки до
 * курсора. Списки строятся один раз (каталог статичен). Hover и signature help —
 * следующий шаг поверх тех же индексов каталога.
 */
import type { OnMount } from '@monaco-editor/react';
import type { Catalog, CatalogEntry } from '@core/index';

type MonacoApi = Parameters<OnMount>[1];
type CompletionProvider = Parameters<MonacoApi['languages']['registerCompletionItemProvider']>[1];
type ProvideFn = NonNullable<CompletionProvider['provideCompletionItems']>;
type TextModel = Parameters<ProvideFn>[0];
type Position = Parameters<ProvideFn>[1];

interface CompletionRow {
  label: string;
  insertText: string;
  detail: string;
  documentation: string;
}

/** Подпись для detail: сигнатура из каталога либо имена ru/en как запасной вариант. */
function detailOf(entry: CatalogEntry): string {
  return entry.signature ?? `${entry.names.ru} (${entry.names.en})`;
}

function toRow(entry: CatalogEntry): CompletionRow {
  return {
    label: entry.names.ru,
    insertText: entry.names.ru,
    detail: detailOf(entry),
    documentation: entry.description,
  };
}

/** Методы, схлопнутые по русскому имени: одинаковые имена разных типов не дублируем. */
function memberRows(catalog: Catalog): CompletionRow[] {
  const seen = new Set<string>();
  const rows: CompletionRow[] = [];
  for (const m of catalog.methods) {
    if (seen.has(m.names.ru)) continue;
    seen.add(m.names.ru);
    rows.push(toRow(m));
  }
  return rows;
}

// Провайдер регистрируем один раз на инстанс Monaco: иначе подсказки задвоятся.
const registered = new WeakSet<MonacoApi>();

export function registerCatalogProviders(monaco: MonacoApi, catalog: Catalog): void {
  if (registered.has(monaco)) return;
  registered.add(monaco);

  const globalRows = catalog.functions.map(toRow);
  const memberRowsCache = memberRows(catalog);
  const Kind = monaco.languages.CompletionItemKind;

  const provider: CompletionProvider = {
    triggerCharacters: ['.'],
    provideCompletionItems(model: TextModel, position: Position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
      const isMember = /\.\s*$/.test(before);

      const rows = isMember ? memberRowsCache : globalRows;
      const kind = isMember ? Kind.Method : Kind.Function;

      return {
        suggestions: rows.map((row) => ({
          label: row.label,
          kind,
          insertText: row.insertText,
          detail: row.detail,
          documentation: { value: row.documentation },
          range,
        })),
      };
    },
  };

  monaco.languages.registerCompletionItemProvider('vb', provider);
}
