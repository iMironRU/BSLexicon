/**
 * Провайдеры автодополнения и hover для SDBL (#38).
 *
 * Простой context-aware completion:
 *  - После `ИЗ` / `СОЕДИНЕНИЕ` — список таблиц из схемы;
 *  - После `.` за именем известной таблицы — её поля;
 *  - После `.` за kind (Справочник/Документ/…) — список имён этого kind;
 *  - Всегда доступны ключевые слова и функции.
 *
 * Полноценный парсер контекста — с помощью нашего же ANTLR-парсера —
 * подключим отдельно (сложнее и медленнее, для MVP не нужно).
 */
import type { Field, Schema, Table } from '../query/types';
import { SDBL_LANGUAGE_ID } from './monaco-lang';

type MonacoNS = typeof import('monaco-editor');

const KEYWORDS = [
  'ВЫБРАТЬ', 'РАЗЛИЧНЫЕ', 'ПЕРВЫЕ', 'ИЗ', 'КАК', 'ГДЕ',
  'СГРУППИРОВАТЬ ПО', 'ИМЕЮЩИЕ', 'УПОРЯДОЧИТЬ ПО', 'УБЫВ', 'ВОЗР',
  'ИТОГИ', 'ОБЩИЕ', 'ПО ОБЩИЕ',
  'ЛЕВОЕ СОЕДИНЕНИЕ', 'ПРАВОЕ СОЕДИНЕНИЕ', 'ВНУТРЕННЕЕ СОЕДИНЕНИЕ',
  'ПОЛНОЕ СОЕДИНЕНИЕ', 'СОЕДИНЕНИЕ', 'ПО',
  'ОБЪЕДИНИТЬ', 'ОБЪЕДИНИТЬ ВСЕ',
  'ПОМЕСТИТЬ', 'УНИЧТОЖИТЬ',
  'ВЫБОР', 'КОГДА', 'ТОГДА', 'ИНАЧЕ', 'КОНЕЦ',
  'И', 'ИЛИ', 'НЕ', 'В', 'В ИЕРАРХИИ', 'МЕЖДУ', 'ПОДОБНО',
  'ЕСТЬ NULL', 'ЕСТЬ NULL', 'ССЫЛКА', 'ВЫРАЗИТЬ',
];

const FUNCTIONS = [
  'СУММА', 'КОЛИЧЕСТВО', 'МАКСИМУМ', 'МИНИМУМ', 'СРЕДНЕЕ',
  'ГОД', 'КВАРТАЛ', 'МЕСЯЦ', 'ДЕНЬ', 'НЕДЕЛЯ', 'ЧАС', 'МИНУТА', 'СЕКУНДА',
  'НАЧАЛОПЕРИОДА', 'КОНЕЦПЕРИОДА', 'ДОБАВИТЬКДАТЕ', 'РАЗНОСТЬДАТ',
  'ДАТАВРЕМЯ', 'ПРЕДСТАВЛЕНИЕ', 'ПРЕДСТАВЛЕНИЕССЫЛКИ',
  'ЕСТЬNULL', 'ТИПЗНАЧЕНИЯ', 'ТИП', 'ЗНАЧЕНИЕ',
];

const CONSTANTS = ['ИСТИНА', 'ЛОЖЬ', 'NULL', 'НЕОПРЕДЕЛЕНО'];

const VT_ACCUM_BALANCE = ['Остатки', 'Обороты', 'ОстаткиИОбороты'];
const VT_INFO_PERIODIC = ['СрезПоследних', 'СрезПервых'];

/** Регистрирует completion + hover. Вызывать один раз в App. */
export function registerSdblProviders(monaco: MonacoNS, schema: Schema): void {
  registerCompletion(monaco, schema);
  registerHover(monaco, schema);
}

// ── Completion ──────────────────────────────────────────────────────

function registerCompletion(monaco: MonacoNS, schema: Schema): void {
  monaco.languages.registerCompletionItemProvider(SDBL_LANGUAGE_ID, {
    // `.` — доступ к полям / имени таблицы после kind
    triggerCharacters: ['.', ' '],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const wordInfo = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, wordInfo.startColumn, position.lineNumber, wordInfo.endColumn);
      const suggestions: import('monaco-editor').languages.CompletionItem[] = [];

      // 1) Точка после `Kind` → имена этого kind
      const afterKind = /(Справочник|Документ|РегистрНакопления|РегистрСведений)\.$/u.exec(line);
      if (afterKind) {
        const kind = afterKind[1] as Table['kind'];
        for (const t of schema.tables) if (t.kind === kind) {
          suggestions.push({
            label: t.name,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: t.name,
            range,
          });
        }
        return { suggestions };
      }

      // 2) Точка после `Kind.Name` → виртуальные таблицы регистра
      const afterVirtOwner = /(РегистрНакопления|РегистрСведений)\.([A-Za-zА-Яа-я_][\w]*)\.$/u.exec(line);
      if (afterVirtOwner) {
        const kind = afterVirtOwner[1] as Table['kind'];
        const name = afterVirtOwner[2];
        const t = schema.tables.find((x) => x.kind === kind && x.name === name);
        if (t) {
          const methods = t.kind === 'РегистрНакопления'
            ? (t.view === 'Обороты' ? ['Обороты'] : VT_ACCUM_BALANCE)
            : t.kind === 'РегистрСведений' && t.periodic
              ? VT_INFO_PERIODIC
              : [];
          for (const m of methods) {
            suggestions.push({
              label: `${m}(&Дата)`,
              kind: monaco.languages.CompletionItemKind.Method,
              insertText: `${m}(&Дата)`,
              range,
            });
          }
          return { suggestions };
        }
      }

      // 3) Точка после `Kind.Name.ТабличнаяЧасть` — не поддерживаем ещё
      // 4) Точка после алиаса — определим по FROM-контексту
      const afterAliasDot = /([A-Za-zА-Яа-я_][\w]*)\.$/u.exec(line);
      if (afterAliasDot) {
        const alias = afterAliasDot[1];
        // Ищем в тексте всего документа: `ИЗ Kind.Name КАК Alias` или короче
        const fromMatch = findSourceForAlias(model.getValue(), alias);
        if (fromMatch) {
          const t = schema.tables.find((x) => `${x.kind}.${x.name}` === fromMatch);
          if (t) {
            for (const f of fieldsOf(t)) {
              suggestions.push({
                label: f.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: typeLabel(f),
                insertText: f.name,
                range,
              });
            }
            return { suggestions };
          }
        }
      }

      // 5) После пробела за токеном ИЗ / СОЕДИНЕНИЕ — все таблицы (полное имя)
      if (/(ИЗ|СОЕДИНЕНИЕ)\s+$/iu.test(line)) {
        for (const t of schema.tables) {
          const ref = `${t.kind}.${t.name}`;
          suggestions.push({
            label: ref,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: ref,
            range,
          });
        }
        return { suggestions };
      }

      // 6) Общий контекст — ключевые слова + функции + константы
      for (const k of KEYWORDS) {
        suggestions.push({ label: k, kind: monaco.languages.CompletionItemKind.Keyword, insertText: k, range });
      }
      for (const f of FUNCTIONS) {
        suggestions.push({ label: f, kind: monaco.languages.CompletionItemKind.Function, insertText: f, range });
      }
      for (const c of CONSTANTS) {
        suggestions.push({ label: c, kind: monaco.languages.CompletionItemKind.Constant, insertText: c, range });
      }
      // Плюс таблицы полными именами для быстрого поиска
      for (const t of schema.tables) {
        const ref = `${t.kind}.${t.name}`;
        suggestions.push({ label: ref, kind: monaco.languages.CompletionItemKind.Class, insertText: ref, range });
      }
      return { suggestions };
    },
  });
}

// ── Hover ─────────────────────────────────────────────────────────

function registerHover(monaco: MonacoNS, schema: Schema): void {
  monaco.languages.registerHoverProvider(SDBL_LANGUAGE_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const name = word.word;
      // Ищем поле среди всех таблиц (может быть collision — покажем все совпадения)
      const hits: string[] = [];
      for (const t of schema.tables) {
        for (const f of fieldsOf(t)) {
          if (f.name === name) hits.push(`**${t.kind}.${t.name}.${f.name}** — ${typeLabel(f)}`);
        }
      }
      // Ищем как таблицу
      const table = schema.tables.find((t) => t.name === name);
      if (table) {
        hits.unshift(`**${table.kind}.${table.name}** — ${countFields(table)} полей${table.kind === 'Справочник' && table.hierarchical ? ', иерархический' : ''}`);
      }
      if (hits.length === 0) return null;
      return {
        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        contents: hits.map((h) => ({ value: h })),
      };
    },
  });
}

// ── Утилиты ──────────────────────────────────────────────────────

/**
 * Ищет в тексте ссылку на алиас: `ИЗ Kind.Name КАК Alias`. Возвращает
 * `Kind.Name`. Простой regex, не парсим полный запрос — MVP.
 */
function findSourceForAlias(text: string, alias: string): string | null {
  const re = new RegExp(`(?:ИЗ|СОЕДИНЕНИЕ)\\s+((?:Справочник|Документ|РегистрНакопления|РегистрСведений)\\.[A-Za-zА-Яа-я_][\\w]*)\\s+КАК\\s+${escapeRegex(alias)}\\b`, 'iu');
  const m = re.exec(text);
  if (m) return m[1];
  // Без «КАК Alias» — алиас может быть равен имени таблицы
  const re2 = new RegExp(`(?:ИЗ|СОЕДИНЕНИЕ)\\s+((?:Справочник|Документ|РегистрНакопления|РегистрСведений)\\.${escapeRegex(alias)})\\b`, 'iu');
  const m2 = re2.exec(text);
  if (m2) return m2[1];
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldsOf(t: Table): Field[] {
  switch (t.kind) {
    case 'Справочник':
    case 'Документ':
      return t.fields;
    case 'РегистрНакопления':
    case 'РегистрСведений':
      return [...t.dimensions, ...t.resources, ...(t.attributes ?? [])];
  }
}

function countFields(t: Table): number {
  return fieldsOf(t).length;
}

function typeLabel(f: Field): string {
  const t = f.type;
  switch (t.kind) {
    case 'Строка': return t.length ? `Строка(${t.length})` : 'Строка';
    case 'Число': return t.digits ? `Число(${t.digits}${t.fraction ? ',' + t.fraction : ''})` : 'Число';
    case 'Ссылка': return `Ссылка → ${t.refs}`;
    default: return t.kind;
  }
}
