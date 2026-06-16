/**
 * Регистрация языка BSL в Monaco: Monarch-грамматика подсветки + конфигурация
 * редактора + тёмная тема. Грамматика переиспользует НАШУ таблицу ключевых слов
 * (`@core` — `KEYWORDS`) и каталог (функции/типы подсвечиваются отдельным цветом),
 * поэтому не расходится с лексером и рантаймом.
 */
import type { OnMount } from '@monaco-editor/react';
import { KEYWORDS } from '@core/index';
import type { Catalog, KeywordKind } from '@core/index';

type MonacoApi = Parameters<OnMount>[1];
type MonarchLanguage = Parameters<MonacoApi['languages']['setMonarchTokensProvider']>[1];
type LanguageConfig = Parameters<MonacoApi['languages']['setLanguageConfiguration']>[1];
type ThemeData = Parameters<MonacoApi['editor']['defineTheme']>[1];

export const BSL_LANGUAGE_ID = 'bsl';
export const BSL_THEME = 'bsl-dark';

/** Литералы-слова (Истина/Ложь/Неопределено/Null) красим как константы, не как ключевые слова. */
const CONSTANT_KINDS = new Set<KeywordKind>(['True', 'False', 'Undefined', 'Null']);

/** Разбивает таблицу ключевых слов на собственно ключевые слова и константы (всё в нижнем регистре). */
function splitKeywords(): { keywords: string[]; constants: string[] } {
  const keywords: string[] = [];
  const constants: string[] = [];
  for (const [spelling, kind] of KEYWORDS) {
    if (CONSTANT_KINDS.has(kind)) constants.push(spelling);
    else keywords.push(spelling);
  }
  return { keywords, constants };
}

function buildMonarch(catalog: Catalog): MonarchLanguage {
  const { keywords, constants } = splitKeywords();
  const catalogFunctions = [...catalog.functionByName.keys()];
  const catalogTypes = catalog.types.flatMap((t) => [
    t.names.ru.toLowerCase(),
    t.names.en.toLowerCase(),
  ]);

  return {
    ignoreCase: true, // BSL регистронезависим
    keywords,
    constants,
    catalogFunctions,
    catalogTypes,
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/'[^']*'/, 'date'], // литерал даты: '20240101'
        [/"/, { token: 'string.quote', next: '@string' }],
        [/\d+(\.\d+)?/, 'number'],
        [
          /[a-zA-Zа-яёА-ЯЁ_][a-zA-Zа-яёА-ЯЁ0-9_]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@constants': 'constant',
              '@catalogFunctions': 'function',
              '@catalogTypes': 'type',
              '@default': 'identifier',
            },
          },
        ],
        [/<>|<=|>=|[-+*/=<>]/, 'operator'],
        [/[()[\],.;?]/, 'delimiter'],
        [/\s+/, 'white'],
      ],
      string: [
        [/""/, 'string.escape'], // экранированная кавычка
        [/[^"]+/, 'string'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  };
}

const LANGUAGE_CONFIG: LanguageConfig = {
  comments: { lineComment: '//' },
  brackets: [
    ['(', ')'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
};

const THEME: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
    { token: 'constant', foreground: '4FC1FF' },
    { token: 'function', foreground: 'DCDCAA' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'string.escape', foreground: 'D7BA7D' },
    { token: 'string.quote', foreground: 'CE9178' },
    { token: 'date', foreground: 'B5CEA8' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'operator', foreground: 'D4D4D4' },
  ],
  colors: {},
};

const registered = new WeakSet<MonacoApi>();

/** Регистрирует язык BSL, грамматику, конфигурацию и тему. Идемпотентно на инстанс Monaco. */
export function registerBslLanguage(monaco: MonacoApi, catalog: Catalog): void {
  if (registered.has(monaco)) return;
  registered.add(monaco);
  monaco.languages.register({ id: BSL_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(BSL_LANGUAGE_ID, buildMonarch(catalog));
  monaco.languages.setLanguageConfiguration(BSL_LANGUAGE_ID, LANGUAGE_CONFIG);
  monaco.editor.defineTheme(BSL_THEME, THEME);
}
