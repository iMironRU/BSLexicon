# Интеграция BSLexicon с книгами

> **Версия контракта: 1.0** (2026-06-22)

BSLexicon принимает BSL-листинги через URL-параметры и умеет:

- заполнить редактор готовым кодом из книги,
- показать читателю, откуда он пришёл,
- свернуться в компактный виджет для встраивания в iframe.

Ядро тренажёра при этом не меняется — это тонкий поверхностный слой.

---

## URL-параметры

Базовый адрес: `https://imironru.github.io/BSLexicon/`

### `?code=<base64>`

BSL-листинг, закодированный в **URL-safe base64** (RFC 4648 §5):
`+` → `-`, `/` → `_`, без символов `=` (padding необязателен).

```
https://imironru.github.io/BSLexicon/?code=0JTQu9GP…
```

**Поведение:**
- Редактор заполняется декодированным кодом. Курсор — на первой строке.
- Код **не запускается автоматически** — читатель нажимает «Запустить» сам.
  (Автозапуск опасен: листинг может содержать бесконечный цикл.)

**Граничные случаи:**

| Ситуация | Результат |
|---|---|
| Невалидный base64 | Редактор пустой, баннер с ошибкой над ним |
| Код > 50 КБ после декодирования | Предупреждение, но код всё равно показан |
| Пустой `?code=` | Параметр игнорируется, редактор в стартовом состоянии |

---

### `?gzcode=<base64>`

То же, что `?code`, но **исходник сжат gzip** перед base64-кодированием.
Используйте для длинных листингов: URL в 3–5 раз короче — критично для QR-кодов
в печатной версии.

При наличии обоих параметров `?gzcode` имеет приоритет.

**Реализация на стороне браузера:** `DecompressionStream('gzip')` — доступен
во всех современных браузерах (Chrome 80+, Firefox 113+, Safari 16.4+).

---

### `?source=<url>`

URL страницы книги, с которой пришёл читатель. Принимается только `http://` или `https://`.

При наличии валидного `?source` над редактором появляется **провенанс-баннер**:

```
📖  Из книги: Основы языка — гл. 3  ↗
```

Весь баннер кликабелен — ведёт обратно на страницу книги в новой вкладке.
Читатель может закрыть баннер крестиком (только на текущую сессию).

**Граничные случаи:**

| Ситуация | Результат |
|---|---|
| `javascript:`, `data:` и другие не-http схемы | Параметр игнорируется, баннера нет |
| Невалидный URL | Параметр игнорируется, баннера нет |
| Длинный URL или заголовок | Обрезается визуально с «…», в `href` сохраняется полностью |

---

### `?title=<text>`

Человекочитаемый заголовок книги или раздела. Отображается в провенанс-баннере вместо
домена из `?source`.

- URL-декодируется автоматически.
- Рендерится **только как текст** (без HTML-интерпретации).
- Если параметр отсутствует — баннер показывает домен из `?source`.

---

### `?embed=1`

Активирует встроенный режим для вставки в `<iframe>`.

**Любое непустое значение = включено:**
`?embed=1`, `?embed=true`, `?embed=yes` — всё работает.
`?embed=0`, `?embed=false` — выключено.

**Что скрывается:**

| Элемент | Обычный режим | Embed |
|---|---|---|
| Шапка (логотип, автор) | ✅ | ❌ |
| Список примеров | ✅ | ❌ |
| Кнопка «Справочник» | ✅ | ❌ |
| Панель-справочник | ✅ | ❌ |
| Подвал | ✅ | ❌ |
| **Провенанс-баннер** | ✅ | **✅ остаётся** |
| Редактор Monaco | ✅ | ✅ |
| Кнопка «Запустить» | ✅ | ✅ |
| Кнопки отладки | ✅ | ✅ |
| Панели «Вывод», «Переменные» | ✅ | ✅ |

Провенанс-баннер в embed-режиме **намеренно остаётся**: он объясняет читателю,
что код пришёл из конкретной книги.

---

## Примеры готовых URL

### Простейший — только код

```
https://imironru.github.io/BSLexicon/?code=0JTQu9GPINCYID0gMSDQn9C-IDUg0KbQuNC60LsKICAgINCh0L7QvtCx0YnQuNGC0Ywo0JgpOwrQmtC-0L3QtdGG0KbQuNC60LvQsDs
```

Декодируется в:
```bsl
Для И = 1 По 5 Цикл
    Сообщить(И);
КонецЦикла;
```

### Код + источник + заголовок

```
https://imironru.github.io/BSLexicon/?code=0JTQu9GPINCYID0gMSDQn9C-IDUg0KbQuNC60LsKICAgINCh0L7QvtCx0YnQuNGC0Ywo0JgpOwrQmtC-0L3QtdGG0KbQuNC60LvQsDs&source=https%3A%2F%2Fmybook.ru%2Fchapter-3&title=%D0%9E%D1%81%D0%BD%D0%BE%D0%B2%D1%8B%20%D1%8F%D0%B7%D1%8B%D0%BA%D0%B0%20%E2%80%94%20%D0%B3%D0%BB.%203
```

### Код + источник + embed (для iframe)

```
https://imironru.github.io/BSLexicon/?code=0JTQu9GPINCYID0gMSDQn9C-IDUg0KbQuNC60LsKICAgINCh0L7QvtCx0YnQuNGC0Ywo0JgpOwrQmtC-0L3QtdGG0KbQuNC60LvQsDs&source=https%3A%2F%2Fmybook.ru%2Fchapter-3&title=%D0%9E%D1%81%D0%BD%D0%BE%D0%B2%D1%8B%20%D1%8F%D0%B7%D1%8B%D0%BA%D0%B0%20%E2%80%94%20%D0%B3%D0%BB.%203&embed=1
```

---

## Как сформировать ссылку

### JavaScript / Node.js (SSG, шаблон книги)

```js
function bslToUrl(code, options = {}) {
  const { source, title, embed } = options;

  // URL-safe base64 без padding
  const bytes = new TextEncoder().encode(code);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const params = new URLSearchParams({ code: b64 });
  if (source) params.set('source', source);
  if (title)  params.set('title', title);
  if (embed)  params.set('embed', '1');

  return `https://imironru.github.io/BSLexicon/?${params}`;
}

// Пример:
bslToUrl(
  'Сообщить("Привет!");',
  { source: 'https://mybook.ru/ch3', title: 'Основы — гл. 3' }
);
```

### Для gzip (длинные листинги — QR-коды, печать)

```js
import { gzipSync } from 'node:zlib'; // Node.js 18+

function bslToUrlGz(code, options = {}) {
  const { source, title, embed } = options;

  const compressed = gzipSync(Buffer.from(code, 'utf8'));
  let bin = '';
  for (const b of compressed) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const params = new URLSearchParams({ gzcode: b64 });
  if (source) params.set('source', source);
  if (title)  params.set('title', title);
  if (embed)  params.set('embed', '1');

  return `https://imironru.github.io/BSLexicon/?${params}`;
}
```

### Встраивание через iframe

```html
<iframe
  src="https://imironru.github.io/BSLexicon/?code=…&source=…&title=…&embed=1"
  width="100%"
  height="480"
  style="border: 1px solid #3c3c3c; border-radius: 6px;"
  loading="lazy"
  title="Запустить листинг в BSLexicon"
></iframe>
```

Рекомендуемые размеры: ширина 600–900 px, высота 400–600 px.

---

## Безопасность

- `?source` проверяется на протокол перед использованием: принимаются только `http://`
  и `https://`. Схемы `javascript:`, `data:` и прочие — отвергаются.
- `?title` и все текстовые параметры рендерятся **только как текст**, без HTML-интерпретации.
- Ссылка на источник открывается с `rel="noopener noreferrer"` — книга не получает доступ
  к `window.opener`.
- Декодирование кода происходит **без исполнения**: читатель запускает код вручную.

---

## Версионирование

Текущая версия контракта: **1.0**.

- **Добавление новых параметров** — обратно совместимо, минорный релиз.
- **Изменение семантики или удаление параметра** — только мажорный релиз с анонсом
  за один минорный цикл.

---

## Журнал изменений

| Дата | Версия | Изменения |
|---|---|---|
| 2026-06-22 | 1.0 | Первый релиз: `?code`, `?gzcode`, `?source`, `?title`, `?embed` |
