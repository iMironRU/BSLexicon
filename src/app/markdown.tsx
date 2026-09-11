import type { ReactNode } from 'react';

/**
 * Мини-рендер markdown для notebook-ячеек. Основано на упрощённой версии
 * из judge-help/TaskPage, расширенной под учебный формат: заголовки
 * `# ## ###`, нумерованные списки, fenced code блоки ```bsl.
 *
 * Никакого HTML — только текст в React-элементах, XSS невозможен.
 * Для более богатого форматирования (таблицы, ссылки, картинки) —
 * подключим полноценную либу отдельным issue, когда потребуется.
 */
export function renderMarkdown(text: string): ReactNode {
  const blocks = splitBlocks(text);
  return blocks.map((block, i) => renderBlock(block, i));
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'code'; lang: string; source: string }
  | { kind: 'ulist'; items: string[] }
  | { kind: 'olist'; items: string[] }
  | { kind: 'para'; text: string };

function splitBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block ```lang ... ```
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const start = i + 1;
      let end = start;
      while (end < lines.length && !lines[end].startsWith('```')) end += 1;
      blocks.push({ kind: 'code', lang, source: lines.slice(start, end).join('\n') });
      i = end + 1;
      continue;
    }

    // heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, text: h[2] });
      i += 1;
      continue;
    }

    // list — собираем идущие подряд строки
    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ulist', items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'olist', items });
      continue;
    }

    // пустая строка — разделитель между блоками
    if (line.trim() === '') { i += 1; continue; }

    // параграф — собираем до пустой строки
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i]) && !/^(#{1,3})\s+/.test(lines[i]) && !/^-\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: 'para', text: paraLines.join(' ') });
  }

  return blocks;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case 'heading':
      if (block.level === 1) return <h1 key={key}>{renderInline(block.text)}</h1>;
      if (block.level === 2) return <h2 key={key}>{renderInline(block.text)}</h2>;
      return <h3 key={key}>{renderInline(block.text)}</h3>;
    case 'code':
      return <pre key={key} className={block.lang ? `md-code md-code--${block.lang}` : 'md-code'}><code>{block.source}</code></pre>;
    case 'ulist':
      return <ul key={key}>{block.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
    case 'olist':
      return <ol key={key}>{block.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>;
    case 'para':
      return <p key={key}>{renderInline(block.text)}</p>;
  }
}

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const chunk = m[0];
    if (chunk.startsWith('`')) {
      parts.push(<code key={`c${i}`}>{chunk.slice(1, -1)}</code>);
    } else if (chunk.startsWith('**')) {
      parts.push(<b key={`b${i}`}>{chunk.slice(2, -2)}</b>);
    } else {
      parts.push(<i key={`i${i}`}>{chunk.slice(1, -1)}</i>);
    }
    last = m.index + chunk.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
