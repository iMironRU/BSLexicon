/**
 * Monarch-грамматика языка запросов 1С для Monaco (#38).
 *
 * Отдельный language id `sdbl` — чтобы не смешивать с BSL из
 * `src/app/monaco/language.ts` (у BSL другой набор ключевых слов
 * и приоритеты подсветки).
 *
 * Полный набор ключевых слов взят из грамматики
 * `src/query/parser/grammar/SDBLLexer.g4`. Названия — русский
 * основной, английские алиасы — синонимами.
 */

// Тип Monaco мы не импортируем напрямую (self-hosted setup). Отдаём
// объекты Monarch — их регистратор ждёт как `unknown`.
type MonacoNS = typeof import('monaco-editor');

export const SDBL_LANGUAGE_ID = 'sdbl';
export const SDBL_THEME_ID = 'sdbl-dark';

const KEYWORDS: string[] = [
  // основные
  'ВЫБРАТЬ', 'РАЗЛИЧНЫЕ', 'ПЕРВЫЕ', 'ИЗ', 'КАК', 'ГДЕ',
  'СГРУППИРОВАТЬ', 'ПО', 'ИМЕЮЩИЕ', 'УПОРЯДОЧИТЬ', 'АВТОУПОРЯДОЧИВАНИЕ',
  'ВОЗР', 'УБЫВ',
  'ИТОГИ', 'ОБЩИЕ', 'ИЕРАРХИЯ', 'ТОЛЬКО',
  // соединения
  'ЛЕВОЕ', 'ПРАВОЕ', 'ПОЛНОЕ', 'ВНУТРЕННЕЕ', 'СОЕДИНЕНИЕ',
  // объединение
  'ОБЪЕДИНИТЬ', 'ВСЕ',
  // подзапросы, ВТ
  'ПОМЕСТИТЬ', 'УНИЧТОЖИТЬ',
  // CASE
  'ВЫБОР', 'КОГДА', 'ТОГДА', 'ИНАЧЕ', 'КОНЕЦ',
  // логика
  'И', 'ИЛИ', 'НЕ',
  // предикаты
  'В', 'МЕЖДУ', 'ПОДОБНО', 'ЕСТЬ', 'ССЫЛКА',
  // выражения
  'ВЫРАЗИТЬ',
];

const CONSTANTS = ['ИСТИНА', 'ЛОЖЬ', 'NULL', 'НЕОПРЕДЕЛЕНО'];

const FUNCTIONS = [
  // агрегаты
  'СУММА', 'КОЛИЧЕСТВО', 'МАКСИМУМ', 'МИНИМУМ', 'СРЕДНЕЕ',
  // дата/время
  'ГОД', 'КВАРТАЛ', 'МЕСЯЦ', 'ДЕНЬ', 'НЕДЕЛЯ', 'ДЕНЬНЕДЕЛИ', 'ЧАС',
  'МИНУТА', 'СЕКУНДА', 'ДЕНЬГОДА', 'НАЧАЛОПЕРИОДА', 'КОНЕЦПЕРИОДА',
  'ДОБАВИТЬКДАТЕ', 'РАЗНОСТЬДАТ', 'ДАТАВРЕМЯ',
  // прочие
  'ПРЕДСТАВЛЕНИЕ', 'ПРЕДСТАВЛЕНИЕССЫЛКИ',
  'ЕСТЬNULL', 'ТИПЗНАЧЕНИЯ', 'ТИП',
  'ЗНАЧЕНИЕ',
];

const VIRTUAL_TABLE_METHODS = [
  'Остатки', 'Обороты', 'ОстаткиИОбороты',
  'СрезПоследних', 'СрезПервых',
  'Границы', 'ДвиженияССубконто',
  'ФактическийПериодДействия', 'ДанныеГрафика', 'БазаРасчёта',
];

/**
 * Monaco Monarch cases matching точное (даже с ignoreCase: true), поэтому
 * генерируем все три варианта регистра: UPPER / lower / Title. Пользователь
 * пишет как удобно, все подсвечиваются.
 */
function anyCase(words: string[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    out.add(w.toLowerCase());
    out.add(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  return [...out];
}

/** Регистрирует язык + тему. Вызывать один раз до маунта Editor. */
export function registerSdblLanguage(monaco: MonacoNS): void {
  // Не повторять регистрацию при HMR — Monaco ругается на дубли.
  const already = monaco.languages.getLanguages().some((l) => l.id === SDBL_LANGUAGE_ID);
  if (already) return;

  monaco.languages.register({ id: SDBL_LANGUAGE_ID, aliases: ['1С Запрос', 'SDBL'] });

  monaco.languages.setLanguageConfiguration(SDBL_LANGUAGE_ID, {
    comments: { lineComment: '//' },
    brackets: [['(', ')']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider(SDBL_LANGUAGE_ID, {
    ignoreCase: true,
    defaultToken: '',
    tokenPostfix: '.sdbl',

    keywords: anyCase(KEYWORDS),
    constants: anyCase(CONSTANTS),
    functions: anyCase(FUNCTIONS),
    vtMethods: anyCase(VIRTUAL_TABLE_METHODS),

    // Kind объектов метаданных — стандартный формат `Kind.Name`.
    metadataKinds: [
      'Справочник', 'Документ',
      'РегистрНакопления', 'РегистрСведений',
      'РегистрБухгалтерии', 'РегистрРасчёта',
      'Перечисление', 'ПланВидовХарактеристик', 'ПланСчетов',
      'ПланОбмена', 'ПланВидовРасчёта',
      'БизнесПроцесс', 'Задача',
      'Константа', 'Последовательность',
      'ЖурналДокументов',
    ],

    tokenizer: {
      root: [
        // строки и числа
        [/"([^"]|"")*"/, 'string'],
        [/\d+(\.\d+)?/, 'number'],

        // однострочные комментарии
        [/\/\/.*$/, 'comment'],

        // параметры &Имя
        [/&[A-Za-zА-Яа-я_][\w]*/u, 'variable.parameter'],

        // виртуальная таблица: `.Остатки(` / `.СрезПоследних(`
        [/\.(Остатки|Обороты|ОстаткиИОбороты|СрезПоследних|СрезПервых|Границы|ДвиженияССубконто|ФактическийПериодДействия|ДанныеГрафика|БазаРасчёта)(?=\s*\()/u, 'type.identifier'],

        // Kind объектов (Справочник/Документ/…) — идёт с точкой перед именем
        [/(Справочник|Документ|РегистрНакопления|РегистрСведений|РегистрБухгалтерии|РегистрРасчёта|Перечисление|ПланВидовХарактеристик|ПланСчетов|ПланОбмена|ПланВидовРасчёта|БизнесПроцесс|Задача|Константа)(?=\s*\.)/u, 'type'],

        // идентификаторы + ключевые слова
        [/[A-Za-zА-Яа-я_][\w]*/u, {
          cases: {
            '@keywords': 'keyword',
            '@constants': 'keyword.constant',
            '@functions': 'support.function',
            '@default': 'identifier',
          },
        }],

        // операторы
        [/[=<>!]=?|<>/, 'operator'],
        [/[+\-*/]/, 'operator'],

        // скобки, разделители
        [/[()]/, '@brackets'],
        [/[,;.]/, 'delimiter'],

        // пробелы
        [/\s+/, 'white'],
      ],
    },
  });

  // Тема с русскими комментариями и подходящими цветами для VS-Dark.
  monaco.editor.defineTheme(SDBL_THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '569cd6', fontStyle: 'bold' },
      { token: 'keyword.constant', foreground: 'dcdcaa', fontStyle: 'bold' },
      { token: 'support.function', foreground: 'dcdcaa' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'type.identifier', foreground: '4ec9b0' },
      { token: 'variable.parameter', foreground: '9cdcfe' },
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'operator', foreground: 'd4d4d4' },
    ],
    colors: {},
  });
}
