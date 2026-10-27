import { describe, expect, it } from 'vitest';
import { CommentHtmlError, escapeHtml, sanitizeCommentHtml, toSafeHtml } from './comment-html';

const errorOf = (input: string) => {
  try {
    sanitizeCommentHtml(input);
  } catch (e) {
    expect(e).toBeInstanceOf(CommentHtmlError);
    return (e as Error).message;
  }
  return null;
};

// Кейсы те же, что в back/src/shared/utils/comment-html.util.spec.ts — правила клиента и сервера совпадают
describe('sanitizeCommentHtml', () => {
  it('пропускает разрешённые теги и экранирует текст', () => {
    expect(sanitizeCommentHtml('Hi <strong>bold</strong> & <i>it</i> <code>x</code>')).toBe('Hi <strong>bold</strong> &amp; <i>it</i> <code>x</code>');
  });

  it('нормализует ссылку и экранирует атрибуты', () => {
    expect(sanitizeCommentHtml(`<A HREF='https://ex.com/?a=1&b=2' title="t">l</A>`)).toBe('<a href="https://ex.com/?a=1&amp;b=2" title="t">l</a>');
  });

  it('одиночный "<" — это текст', () => {
    expect(sanitizeCommentHtml('a < b > c')).toBe('a &lt; b &gt; c');
  });

  it('нормализует переводы строк и экранирует кавычки', () => {
    expect(sanitizeCommentHtml(`line1\r\nline2\r"q" 'a'`)).toBe('line1\nline2\n&quot;q&quot; &#39;a&#39;');
  });

  it('пустая строка и текст без тегов', () => {
    expect(sanitizeCommentHtml('')).toBe('');
    expect(sanitizeCommentHtml('plain')).toBe('plain');
  });

  it('ссылка без title и с пробелами вокруг значения', () => {
    expect(sanitizeCommentHtml('<a href=" https://x.io ">x</a>')).toBe('<a href="https://x.io">x</a>');
  });

  it.each([
    ['<script>alert(1)</script>', 'Тег запрещён (разрешены: a, code, i, strong): script'],
    ['<img src=x onerror=alert(1)>', 'Некорректный тег'],
    ['<i onclick="x">a</i>', 'Атрибут запрещён: i.onclick'],
    ['<a href="javascript:alert(1)">x</a>', 'Ссылка должна начинаться с http:// или https://'],
    ['<a title="x">x</a>', 'У ссылки должен быть атрибут href'],
    ['<strong><i>x</strong></i>', 'Неожиданный закрывающий тег: </strong>'],
    ['<code>x', 'Тег не закрыт: <code>'],
    ['x</i>', 'Неожиданный закрывающий тег: </i>'],
    ['<a href="https://a.b"><a href="https://a.b">x</a></a>', 'Ссылки не могут быть вложенными'],
    ['<i/>', 'Некорректный тег'],
    ['<a href="https://a.b" href="https://c.d">x</a>', 'Атрибут повторяется: a.href'],
    ['x</b>', 'Тег запрещён (разрешены: a, code, i, strong): b'],
  ])('%s → %s', (input, message) => {
    expect(errorOf(input)).toBe(message);
  });
});

describe('escapeHtml', () => {
  it('экранирует все спецсимволы', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('toSafeHtml', () => {
  it.each([
    'Hello <strong>world</strong>',
    '<i>a</i> <code>b</code>',
    '<a href="https://x.io/?a=1&amp;b=2" title="t">l</a>',
    '<a href="http://x.io">l</a>',
    'просто текст &lt;script&gt;',
  ])('канонический HTML проходит без изменений: %s', (html) => {
    expect(toSafeHtml(html)).toBe(html);
  });

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="https://x.io" onclick="y">x</a>',
    '<i class="x">a</i>',
    '<b>bold</b>',
    'unclosed <a href="https://x.io"',
  ])('любой посторонний тег/атрибут — весь текст экранируется: %s', (html) => {
    expect(toSafeHtml(html)).toBe(escapeHtml(html));
  });
});
