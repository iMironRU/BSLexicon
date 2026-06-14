/**
 * Провайдеры синтакс-помощника Monaco поверх каталога языка: автодополнение,
 * hover (справка по наведению) и signature help (параметры при вызове).
 *
 * Все три читают один индексированный каталог (`@core` — `Catalog`); тексты —
 * наши (поле `description`/`params`/`returns` из `catalog/*.yaml`). Регистрируем
 * один раз на инстанс Monaco, иначе подсказки и тултипы задвоятся.
 */
import type { OnMount } from '@monaco-editor/react';
import type { Catalog, CatalogEntry } from '@core/index';

type MonacoApi = Parameters<OnMount>[1];
type CompletionProvider = Parameters<MonacoApi['languages']['registerCompletionItemProvider']>[1];
type HoverProvider = Parameters<MonacoApi['languages']['registerHoverProvider']>[1];
type SignatureProvider = Parameters<MonacoApi['languages']['registerSignatureHelpProvider']>[1];
type ProvideCompletion = NonNullable<CompletionProvider['provideCompletionItems']>;
type TextModel = Parameters<ProvideCompletion>[0];
type Position = Parameters<ProvideCompletion>[1];

const KIND_LABEL: Record<CatalogEntry['kind'], string> = {
  function: 'функция',
  method: 'метод',
  type: 'тип',
};

/** Контекст «после точки» (обращение к члену) по тексту строки до слова. */
function isMemberContext(prefix: string): boolean {
  return /\.\s*$/.test(prefix);
}

/**
 * Запись каталога по имени с учётом контекста: после точки приоритет методу,
 * иначе функции/типу. BSL регистронезависим — ищем по нижнему регистру.
 */
function lookup(catalog: Catalog, name: string, isMember: boolean): CatalogEntry | undefined {
  const matches = catalog.byName.get(name.toLowerCase());
  if (!matches || matches.length === 0) return undefined;
  if (isMember) return matches.find((e) => e.kind === 'method') ?? matches[0];
  return (
    matches.find((e) => e.kind === 'function') ??
    matches.find((e) => e.kind === 'type') ??
    matches[0]
  );
}

/** Сигнатура для подписи: своя из `params`/`returns`, иначе из каталога. */
function signatureLabel(entry: CatalogEntry): string {
  if (entry.params && entry.params.length > 0) {
    const args = entry.params.map((p) => p.name).join(', ');
    const ret = entry.returns ? `: ${entry.returns.type}` : '';
    return `${entry.names.ru}(${args})${ret}`;
  }
  return entry.signature ?? `${entry.names.ru}()`;
}

// --- Автодополнение ---

interface CompletionRow {
  label: string;
  detail: string;
  documentation: string;
}

function toRow(entry: CatalogEntry): CompletionRow {
  return {
    label: entry.names.ru,
    detail: entry.signature ?? `${entry.names.ru} (${entry.names.en})`,
    documentation: entry.description,
  };
}

function registerCompletion(monaco: MonacoApi, catalog: Catalog): void {
  const globalRows = catalog.functions.map(toRow);
  const seen = new Set<string>();
  const memberRows: CompletionRow[] = [];
  for (const m of catalog.methods) {
    if (seen.has(m.names.ru)) continue;
    seen.add(m.names.ru);
    memberRows.push(toRow(m));
  }
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
      const member = isMemberContext(
        model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1),
      );
      const rows = member ? memberRows : globalRows;
      const kind = member ? Kind.Method : Kind.Function;

      return {
        suggestions: rows.map((row) => ({
          label: row.label,
          kind,
          insertText: row.label,
          detail: row.detail,
          documentation: { value: row.documentation },
          range,
        })),
      };
    },
  };

  monaco.languages.registerCompletionItemProvider('vb', provider);
}

// --- Hover ---

/** Markdown-карточка записи для тултипа. */
function hoverMarkdown(entry: CatalogEntry): string {
  const lines = [`**${entry.names.ru}**  ·  ${entry.names.en}  ·  _${KIND_LABEL[entry.kind]}_`];
  if (entry.signature) lines.push('', '```', entry.signature, '```');
  if (entry.description) lines.push('', entry.description);
  if (entry.params && entry.params.length > 0) {
    lines.push('', '**Параметры:**');
    for (const p of entry.params) {
      const opt = p.optional ? ', необязательный' : '';
      const desc = p.description ? ` — ${p.description}` : '';
      lines.push(`- \`${p.name}\`: ${p.type}${opt}${desc}`);
    }
  }
  if (entry.returns) {
    const desc = entry.returns.description ? ` — ${entry.returns.description}` : '';
    lines.push('', `**Возвращает:** ${entry.returns.type}${desc}`);
  }
  return lines.join('\n');
}

function registerHover(monaco: MonacoApi, catalog: Catalog): void {
  const provider: HoverProvider = {
    provideHover(model: TextModel, position: Position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const member = isMemberContext(
        model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1),
      );
      const entry = lookup(catalog, word.word, member);
      if (!entry) return null;
      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
        contents: [{ value: hoverMarkdown(entry) }],
      };
    },
  };

  monaco.languages.registerHoverProvider('vb', provider);
}

// --- Signature help ---

interface CallContext {
  name: string;
  isMember: boolean;
  activeParam: number;
}

/**
 * Ищет охватывающий вызов: от курсора назад до незакрытой «(», считая запятые
 * верхнего уровня (активный параметр) и снимая имя вызываемого перед скобкой.
 */
function findCall(text: string): CallContext | null {
  let depth = 0;
  let activeParam = 0;
  let i = text.length - 1;
  for (; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) {
      activeParam++;
    }
  }
  if (i < 0) return null;

  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  const end = j + 1;
  while (j >= 0 && /[A-Za-zА-Яа-яЁё0-9_]/.test(text[j])) j--;
  const name = text.slice(j + 1, end);
  if (!name) return null;

  let k = j;
  while (k >= 0 && /\s/.test(text[k])) k--;
  return { name, isMember: text[k] === '.', activeParam };
}

function registerSignatureHelp(monaco: MonacoApi, catalog: Catalog): void {
  const provider: SignatureProvider = {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp(model: TextModel, position: Position) {
      const text = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const call = findCall(text);
      if (!call) return null;
      const entry = lookup(catalog, call.name, call.isMember);
      if (!entry || !entry.params || entry.params.length === 0) return null;

      return {
        value: {
          signatures: [
            {
              label: signatureLabel(entry),
              documentation: { value: entry.description },
              parameters: entry.params.map((p) => ({
                label: p.name,
                documentation: {
                  value: `${p.type}${p.optional ? ', необязательный' : ''}${
                    p.description ? ` — ${p.description}` : ''
                  }`,
                },
              })),
            },
          ],
          activeSignature: 0,
          activeParameter: Math.min(call.activeParam, entry.params.length - 1),
        },
        dispose() {},
      };
    },
  };

  monaco.languages.registerSignatureHelpProvider('vb', provider);
}

// --- Регистрация всех провайдеров (один раз на инстанс Monaco) ---

const registered = new WeakSet<MonacoApi>();

export function registerCatalogProviders(monaco: MonacoApi, catalog: Catalog): void {
  if (registered.has(monaco)) return;
  registered.add(monaco);
  registerCompletion(monaco, catalog);
  registerHover(monaco, catalog);
  registerSignatureHelp(monaco, catalog);
}
