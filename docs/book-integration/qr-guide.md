# QR-коды в печатной версии книги

Для PDF/EPUB/бумаги кликнуть на ссылку BSLexicon нельзя — QR-код рядом
с листингом или задачей решает: читатель наводит камеру телефона,
попадает сразу в тренажёр.

## Что кодируем

### Sandbox-листинг (код из главы)

QR ведёт на «редактор с этим кодом»:

```
https://imironru.github.io/BSLexicon/?gzcode=<gz+base64>&source=<url-главы>&title=<Книга — § N.M>
```

- `?gzcode` (сжатый gzip) вместо `?code` — URL короче в 3–5 раз,
  QR получается крупнее и лучше сканируется с бумаги.
- `?source` и `?title` заполняют провенанс-баннер над редактором
  («📖 Из книги: … ↗»).

Подробности параметров → [`url-contract.md`](./url-contract.md).

### Задача Judge

QR ведёт на страницу задачи:

```
https://imironru.github.io/BSLexicon/help/judge/#/task/<book_id>/<task_id>
```

Никаких query-параметров — стабильный hash-роут. Читатель попадает
на экран с условием, стартовым кодом и чек-поинтами.

## Как генерировать в mdBook

Простой путь — препроцессор на Node.js, использующий npm-пакет
[`qrcode`](https://www.npmjs.com/package/qrcode). Модуль пишет SVG
или PNG рядом с исходником главы, в HTML/EPUB вставляется `<img>`.

Скетч (в `book.sh` или отдельном препроцессоре):

```js
import QRCode from 'qrcode';
import { gzipSync } from 'node:zlib';

// URL-safe base64 без padding — согласовано с ?gzcode
function b64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bslSandboxUrl(code, source, title) {
  const gz = gzipSync(Buffer.from(code, 'utf8'));
  const p = new URLSearchParams({ gzcode: b64url(gz) });
  if (source) p.set('source', source);
  if (title) p.set('title', title);
  return `https://imironru.github.io/BSLexicon/?${p}`;
}

async function qrSvg(url, out) {
  await QRCode.toFile(out, url, {
    type: 'svg',
    errorCorrectionLevel: 'M',     // 15% восстановление — хватает бумаги
    margin: 2,
    width: 240,
  });
}
```

**Уровень коррекции ошибок:** для бумаги — `M` (15%). Если QR печатается
маленьким или на плохой бумаге — `Q` (25%), но код получится плотнее.

**Размер:** минимум 240×240 px для веб (≈ 25×25 мм в PDF при 300 dpi).
Меньше — сканируется с трудом на некоторых телефонах.

## Что рядом с QR

Всегда — **человекочитаемая подпись**: «Запустить в BSLexicon» и,
опционально, короткий URL под ним. Читатель без телефона должен
понять, куда его ведут.

Пример разметки для главы (после кодоблока с sandbox-листингом):

```markdown
[![QR: запустить в BSLexicon](./assets/qr/ch01-listing-01.svg)](https://imironru.github.io/BSLexicon/?gzcode=…)

*Отсканируй QR или зайди по адресу выше — код откроется в тренажёре.*
```

## На чём мы не экономим

- **Стабильный URL.** Один раз опубликовали книгу с QR → URL никогда
  не меняем. Смена доменa или переезд с GitHub Pages — только с редиректом.
- **Проверенный тестами `?gzcode`.** У BSLexicon уже есть e2e для этого
  параметра; при любых изменениях подсказки книги остаются рабочими.
- **Fallback без QR.** Читатель без камеры (или скептик) должен получить
  тот же результат по ссылке из PDF-hyperlink или из URL под QR.
