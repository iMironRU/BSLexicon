/**
 * Pipeline для /help/bsp/ (issue #9). Читает katalog.yaml книги про БСП
 * (см. reference/istochniki.md там же), проходит по XML-выгрузке БСП
 * 3.1.12, извлекает экспортные процедуры/функции переопределяемых
 * модулей вместе с блоком комментария над ними, эмитит
 * public/reference/bsp-hooks.json.
 *
 * Источники — вне репозитория, скрипт запускается локально:
 *   BSP_UNPACK_DIR — путь к XML-выгрузке (по умолчанию у peer'а
 *   ~/Documents/github_dev/chronicon/base/bsp-merged-unpack)
 *   BSP_KATALOG_YAML — katalog.yaml подсистем (книга про БСП)
 *
 * Что публикуем и на каких основаниях. Module.bsl БСП распространяется
 * под CC BY 4.0 — секцию «Параметры:» и docstring комментарии можно
 * публиковать дословно с атрибуцией: © ООО «1С-Софт», ссылка на
 * лицензию https://creativecommons.org/licenses/by/4.0/legalcode и
 * пометка при сокращении. Атрибуция ставится компонентом в UI, здесь
 * в JSON закладываются данные (source: module + procedure).
 *
 * Фаза A — только пилотные подсистемы из PHASE_A_ALLOWLIST. Фаза B
 * расширит список.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { load as parseYaml } from 'js-yaml';

const BSP_UNPACK_DIR = process.env.BSP_UNPACK_DIR
  ?? join(homedir(), 'Documents/github_dev/chronicon/base/bsp-merged-unpack');

const BSP_KATALOG_YAML = process.env.BSP_KATALOG_YAML
  ?? join(homedir(), 'Documents/me-books/1c/1c-bsp/reference/katalog.yaml');

/** Фаза A: одна подсистема, чтобы проверить контракт. */
const PHASE_A_ALLOWLIST = new Set<string>([
  'Базовая функциональность',
]);

const OUT = resolve('public/reference/bsp-hooks.json');

const BSP_VERSION = '3.1.12.218';
const LICENSE = {
  spdx: 'CC-BY-4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/legalcode',
  holder: '© ООО «1С-Софт»',
};

// ── Типы контракта JSON ──────────────────────────────────────────

interface BspParam {
  name: string;
  /** Свободный текст типа как в шапке («Строка», «Число», «Массив из Структура» …). */
  type: string;
  /** Docstring параметра, ужe отрезанный от заголовка. Может быть пустой. */
  description: string;
}

interface BspProcedure {
  /** Имя процедуры / функции. */
  name: string;
  kind: 'Процедура' | 'Функция';
  /** Полная сигнатура одной строкой: имя + список параметров + `Экспорт`. */
  signature: string;
  /** Список параметров из сигнатуры (имя + опциональное значение по умолчанию). */
  params: BspParam[];
  /** Есть ли `Экспорт` — на всякий случай, для отладки; ожидаем всегда true. */
  exportFlag: boolean;
  /**
   * Полный блок комментария над процедурой (несколько строк, без ведущих `//`).
   * Оставляем как есть — UI решит, что и как показать. Атрибуция обязательна
   * (см. модуль-заголовок скрипта).
   */
  docstring: string;
}

interface BspModule {
  name: string;
  /** Клиент/Сервер эвристикой по имени. */
  side: 'Клиент' | 'Сервер';
  procedures: BspProcedure[];
}

interface BspSubsystem {
  name: string;
  /** Способы сцепки из katalog.yaml — «объявление», «обратный вызов», «вызов». */
  ways: string[];
  modules: BspModule[];
}

export interface BspHooksJson {
  bspVersion: string;
  license: typeof LICENSE;
  generatedAt: string;
  subsystems: BspSubsystem[];
}

// ── Katalog ──────────────────────────────────────────────────────

interface KatalogEntry {
  имя: string;
  способы?: string[];
  признаки_объявление?: string[];
}

interface Katalog {
  подсистемы: KatalogEntry[];
}

function loadKatalog(): Katalog {
  const raw = readFileSync(BSP_KATALOG_YAML, 'utf8');
  return parseYaml(raw) as Katalog;
}

// ── Резолвинг имён модулей ───────────────────────────────────────

/**
 * В katalog.yaml имена модулей иногда обрезаны (например
 * «ДополнительныеОтчетыИОбработкиКлиентПереопре» — 41 символ). Резолвим
 * префиксным совпадением с директориями CommonModules.
 */
function listPereopredelyaemyeModules(): string[] {
  const dir = join(BSP_UNPACK_DIR, 'CommonModules');
  return readdirSync(dir).filter((n) => n.endsWith('Переопределяемый'));
}

function resolveModuleName(shortOrFull: string, all: string[]): string | null {
  if (all.includes(shortOrFull)) return shortOrFull;
  const matches = all.filter((n) => n.startsWith(shortOrFull));
  if (matches.length === 1) return matches[0];
  // Неоднозначно / не совпало — молча пропустим (не крашим фазу A).
  return null;
}

// ── Парсер Module.bsl ────────────────────────────────────────────

const EXPORT_RE = /^(Процедура|Функция)\s+([А-Яа-я\w]+)\s*\(([\s\S]*?)\)\s+Экспорт/;

/**
 * Разбирает Module.bsl. Идёт построчно, при встрече `Процедура X(...) Экспорт`
 * или `Функция X(...) Экспорт` собирает предшествующий блок `//`-комментариев
 * (до первой пустой или не-комментарной строки, включая директивы `&НаКлиенте`
 * и `#Область`).
 */
function parseModule(text: string): BspProcedure[] {
  // Убираем `\r`, сплитим по строкам.
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const procs: BspProcedure[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    // Экспорт может быть в конце сигнатуры на одной строке, а сигнатура —
    // на нескольких. Собираем декларацию с `Процедура`/`Функция` и до `)`.
    const line = lines[i];
    if (!/^(Процедура|Функция)\s+/.test(line)) continue;
    let decl = line;
    let j = i;
    while (!/\)\s*(Экспорт)?\s*$/.test(decl) && j + 1 < lines.length) {
      j += 1;
      decl += ' ' + lines[j].trim();
    }
    // `\b` в JS-регэкспе работает по ASCII-\w, между кириллическим `т` и
    // концом строки границы нет — используем подстроку с пробелом.
    if (!/\sЭкспорт(?:\s|$)/.test(decl) && !/^Экспорт(?:\s|$)/.test(decl)) {
      // Внутренняя процедура — пропускаем.
      i = j;
      continue;
    }

    const m = decl.match(EXPORT_RE);
    if (!m) { i = j; continue; }

    const kind = m[1] as 'Процедура' | 'Функция';
    const name = m[2];
    const paramsRaw = m[3];
    const params = parseSignatureParams(paramsRaw);
    const signature = `${kind} ${name}(${paramsRaw.trim()}) Экспорт`.replace(/\s+/g, ' ');

    // Идём вверх, собираем блок комментария.
    const docLines: string[] = [];
    for (let k = i - 1; k >= 0; k -= 1) {
      const c = lines[k];
      if (/^\s*\/\//.test(c)) {
        // Обрезаем ведущие пробелы и `//` (с одним пробелом после при
        // наличии). Пустой комментарий-разделитель `//` тоже сохраняем.
        docLines.unshift(c.replace(/^\s*\/\/\s?/, ''));
      } else if (/^\s*$/.test(c)) {
        // Пустая строка — стоп, если docLines уже что-то есть; иначе тоже стоп.
        break;
      } else {
        break;
      }
    }
    // Отбрасываем ведущие/хвостовые декоративные линии `//////`.
    const docstring = docLines
      .filter((l) => !/^\/\/+$/.test(l))
      .join('\n')
      .trim();

    procs.push({ name, kind, signature, params, exportFlag: true, docstring });
    i = j;
  }
  return procs;
}

/**
 * Разбирает список параметров из сигнатуры. Возвращает имя + пустой тип
 * и описание — эти поля заполняются на следующем шаге из docstring.
 * Здесь только парсим саму сигнатуру.
 */
function parseSignatureParams(raw: string): BspParam[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parts = splitTopLevel(trimmed, ',');
  return parts.map((p) => {
    // Формы: `Имя`, `Знач Имя`, `Имя = ...`, `Знач Имя = ...`
    const cleaned = p.replace(/^\s*Знач\s+/, '').trim();
    const name = cleaned.split(/\s*=\s*/)[0];
    return { name, type: '', description: '' };
  });
}

/** Разделение по разделителю на верхнем уровне скобок. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

// ── Обогащение параметров из docstring ───────────────────────────

/**
 * Секция «Параметры:» в шапке БСП имеет разнообразный формат — тип может
 * идти как «Строка -», «Строка - описание», «Массив из Строка» и т.п.
 * Достаём машинно: имя параметра из сигнатуры → первая строка в
 * docstring, где встречается `<Имя>`, читаем до конца строки и берём
 * фрагмент типа/описания.
 *
 * Best-effort: если не нашли — оставляем пустые. UI покажет сигнатуру,
 * а секция «Параметры:» будет пустой (или полностью не отрендерится).
 */
function enrichParams(proc: BspProcedure): void {
  const lines = proc.docstring.split('\n');
  for (const param of proc.params) {
    // Ищем `* <Имя> -` или `  <Имя> -`.
    const re = new RegExp(`^[\\s*]*${escapeRegExp(param.name)}\\s*[-–—]\\s*(.+)$`);
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i])) { start = i; break; }
    }
    if (start === -1) continue;
    // Первая строка — сюда попадает тип и, возможно, начало описания.
    const first = lines[start].match(re)![1].trim();
    // Тип — первый токен(ы) до `-` или до конца, если `-` не осталось.
    // Формат в БСП: «<Тип> - <описание>» или «<Тип>» без описания.
    const typeAndDesc = first.split(/\s+[-–—]\s+/);
    param.type = typeAndDesc[0].trim();
    let desc = typeAndDesc.slice(1).join(' - ').trim();

    // Собираем продолжение — строки с большим отступом или начинающиеся
    // на «  * » (вложенные поля структуры мы не берём, только описание
    // самого параметра).
    for (let i = start + 1; i < lines.length; i += 1) {
      const l = lines[i];
      if (!/^\s{2,}/.test(l) || /^\s*\*\s+/.test(l)) break;
      const cont = l.trim();
      if (!cont) break;
      // Следующий именованный параметр — прекращаем.
      if (proc.params.some((p) => new RegExp(`^${escapeRegExp(p.name)}\\s*[-–—]`).test(cont))) break;
      desc += ' ' + cont;
    }
    param.description = desc.trim();
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Сборка одной подсистемы ──────────────────────────────────────

function buildSubsystem(entry: KatalogEntry, allModules: string[]): BspSubsystem | null {
  const declared = entry.признаки_объявление ?? [];
  const moduleNames = declared
    .map((n) => resolveModuleName(n, allModules))
    .filter((n): n is string => n !== null)
    .filter((n) => n.endsWith('Переопределяемый'));

  if (moduleNames.length === 0) return null;

  const modules: BspModule[] = [];
  for (const moduleName of moduleNames) {
    const modulePath = join(BSP_UNPACK_DIR, 'CommonModules', moduleName, 'Ext', 'Module.bsl');
    if (!existsSync(modulePath)) {
      console.warn(`Пропускаю модуль без Module.bsl: ${moduleName}`);
      continue;
    }
    const text = readFileSync(modulePath, 'utf8');
    const procedures = parseModule(text);
    for (const p of procedures) enrichParams(p);
    const side: 'Клиент' | 'Сервер' = /Клиент/.test(moduleName) ? 'Клиент' : 'Сервер';
    modules.push({ name: moduleName, side, procedures });
  }
  return {
    name: entry.имя,
    ways: entry.способы ?? [],
    modules,
  };
}

// ── main ─────────────────────────────────────────────────────────

function main(): void {
  console.log('BSP unpack:', BSP_UNPACK_DIR);
  console.log('Katalog:   ', BSP_KATALOG_YAML);
  if (!existsSync(BSP_UNPACK_DIR)) {
    console.error(`Не найдена XML-выгрузка БСП: ${BSP_UNPACK_DIR}`);
    console.error('Задайте BSP_UNPACK_DIR или положите выгрузку по указанному пути.');
    process.exit(1);
  }
  if (!existsSync(BSP_KATALOG_YAML)) {
    console.error(`Не найден katalog.yaml: ${BSP_KATALOG_YAML}`);
    process.exit(1);
  }

  const katalog = loadKatalog();
  const allModules = listPereopredelyaemyeModules();
  console.log(`Всего *Переопределяемый модулей в выгрузке: ${allModules.length}`);

  const subsystems: BspSubsystem[] = [];
  for (const entry of katalog.подсистемы) {
    if (!PHASE_A_ALLOWLIST.has(entry.имя)) continue;
    const s = buildSubsystem(entry, allModules);
    if (s) subsystems.push(s);
  }

  const total = subsystems.reduce((n, s) => n + s.modules.reduce((m, mod) => m + mod.procedures.length, 0), 0);
  console.log(`Подсистем в выдаче: ${subsystems.length}, процедур: ${total}`);

  const out: BspHooksJson = {
    bspVersion: BSP_VERSION,
    license: LICENSE,
    generatedAt: new Date().toISOString(),
    subsystems,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('Записано:', OUT);
}

main();
