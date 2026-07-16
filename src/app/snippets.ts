/**
 * Персистентность кода тренажёра между сессиями.
 *
 * Два уровня:
 *  1. draft — один слот с последним набранным кодом (автосохранение).
 *     Восстанавливается при открытии тренажёра, если нет URL-параметра
 *     `?code=…`. Пишется дебаунсом (500 мс) — при каждом изменении.
 *  2. snippets — именованный список сохранённых сниппетов. Пользователь
 *     явно «Сохранить как…» → добавляется в список; клик по имени —
 *     загружается в редактор.
 *
 * Хранилище — localStorage; при недоступности (Safari Private) всё
 * работает как обычно, но между сессиями ничего не сохраняется.
 * Также экспорт/импорт JSON-файлом — для переноса между устройствами.
 */

const KEY_DRAFT = 'bslexicon:trainer:draft';
const KEY_SNIPPETS = 'bslexicon:trainer:snippets';

export interface Snippet {
  id: string;
  name: string;
  code: string;
  /** Unix-ms. Для сортировки «свежие сверху». */
  createdAt: number;
}

interface SnippetsFile {
  version: 1;
  items: Snippet[];
}

// ── Draft (одна ячейка) ──────────────────────────────────────────────

export function loadDraft(): string | null {
  try {
    const v = localStorage.getItem(KEY_DRAFT);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function saveDraft(code: string): void {
  try {
    localStorage.setItem(KEY_DRAFT, code);
  } catch {
    // storage недоступен — молча игнорируем
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY_DRAFT);
  } catch {
    // ignore
  }
}

// ── Именованные сниппеты (список) ────────────────────────────────────

export function listSnippets(): Snippet[] {
  return parseSnippets(rawSnippets());
}

/**
 * Добавить новый сниппет с заданным именем. Возвращает вставленную
 * запись (с сгенерированным id). Пустое имя обрезается — вызывающий
 * должен валидировать до вызова.
 */
export function saveSnippet(name: string, code: string, now: number = Date.now()): Snippet {
  const trimmed = name.trim();
  const snippet: Snippet = {
    id: genId(now),
    name: trimmed || 'Без имени',
    code,
    createdAt: now,
  };
  const items = listSnippets();
  items.unshift(snippet);
  writeSnippets(items);
  return snippet;
}

export function deleteSnippet(id: string): void {
  writeSnippets(listSnippets().filter((s) => s.id !== id));
}

export function renameSnippet(id: string, newName: string): void {
  const trimmed = newName.trim();
  if (!trimmed) return;
  writeSnippets(
    listSnippets().map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
  );
}

// ── Экспорт / импорт файлом ──────────────────────────────────────────

/** JSON-строка для скачивания как `bslexicon-snippets.json`. */
export function exportAll(items: Snippet[] = listSnippets()): string {
  const payload: SnippetsFile = { version: 1, items };
  return JSON.stringify(payload, null, 2);
}

export interface ImportResult {
  added: number;
  skipped: number;
  error: string | null;
}

/**
 * Прочитать JSON и добавить сниппеты в хранилище. `mode: 'merge'` —
 * дописать к существующим (по умолчанию); `'replace'` — заменить весь
 * список. Битые записи молча пропускаются; полностью невалидный JSON
 * возвращает error.
 */
export function importAll(
  json: string,
  mode: 'merge' | 'replace' = 'merge',
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { added: 0, skipped: 0, error: (e as Error).message };
  }

  const incoming = normalizeImport(parsed);
  if (incoming === null) {
    return { added: 0, skipped: 0, error: 'Ожидалась структура {version, items:[…]}' };
  }

  const valid = incoming.filter(isValidImportItem);
  const skipped = incoming.length - valid.length;

  const now = Date.now();
  const existing = mode === 'replace' ? [] : listSnippets();
  // Гарантируем уникальные id и валидное имя.
  const normalized = valid.map((v, i): Snippet => ({
    id: genId(now + i),
    name: v.name.trim() || 'Без имени',
    code: v.code,
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : now + i,
  }));
  writeSnippets([...normalized, ...existing]);
  return { added: normalized.length, skipped, error: null };
}

// ── Служебные ────────────────────────────────────────────────────────

function rawSnippets(): unknown {
  try {
    const raw = localStorage.getItem(KEY_SNIPPETS);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function parseSnippets(raw: unknown): Snippet[] {
  if (!raw || typeof raw !== 'object') return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter(isSnippet);
}

function writeSnippets(items: Snippet[]): void {
  const payload: SnippetsFile = { version: 1, items };
  try {
    localStorage.setItem(KEY_SNIPPETS, JSON.stringify(payload));
  } catch {
    // storage недоступен (кавычек не хватило, private mode) — тихо
  }
}

function isSnippet(v: unknown): v is Snippet {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.code === 'string' &&
    typeof o.createdAt === 'number'
  );
}

interface ImportItem { name: string; code: string; createdAt?: number }

function isValidImportItem(v: unknown): v is ImportItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === 'string' && typeof o.code === 'string';
}

/** Принимает `{version,items}` либо голый массив; иначе — null. */
function normalizeImport(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) {
    return (raw as { items: unknown[] }).items;
  }
  return null;
}

let idCounter = 0;
function genId(now: number): string {
  // Time-based + монотонный счётчик, чтобы id были уникальны при
  // импорте пачкой в одну миллисекунду.
  idCounter = (idCounter + 1) & 0xffff;
  return `${now.toString(36)}-${idCounter.toString(36).padStart(3, '0')}`;
}
