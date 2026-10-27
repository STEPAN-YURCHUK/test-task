import { COMMENT_TEXT_MAX_LENGTH, escapeHtml, getCommentPlainText, sanitizeCommentHtml } from './comment-html.util';

const errorKey = (fn: () => unknown) => {
    try {
        fn();
    } catch (e: any) {
        return e.message;
    }
    return null;
};

describe('sanitizeCommentHtml', () => {
    it('пропускает разрешённые теги и экранирует текст', () => {
        expect(sanitizeCommentHtml('Hi <strong>bold</strong> & <i>it</i> <code>x</code>')).toBe(
            'Hi <strong>bold</strong> &amp; <i>it</i> <code>x</code>',
        );
    });

    it('нормализует ссылку и экранирует атрибуты', () => {
        expect(sanitizeCommentHtml(`<A HREF='https://ex.com/?a=1&b=2' title="t">l</A>`)).toBe(
            '<a href="https://ex.com/?a=1&amp;b=2" title="t">l</a>',
        );
    });

    it('одиночный "<" — это текст', () => {
        expect(sanitizeCommentHtml('a < b > c')).toBe('a &lt; b &gt; c');
    });

    it.each([
        ['<script>alert(1)</script>', 'text_tag_not_allowed:script'],
        ['<img src=x onerror=alert(1)>', 'text_malformed_tag'],
        ['<i onclick="x">a</i>', 'text_attribute_not_allowed:i.onclick'],
        ['<a href="javascript:alert(1)">x</a>', 'text_unsafe_url'],
        ['<a title="x">x</a>', 'text_link_href_required'],
        ['<strong><i>x</strong></i>', 'text_unexpected_closing_tag:strong'],
        ['<code>x', 'text_tag_not_closed:code'],
        ['x</i>', 'text_unexpected_closing_tag:i'],
        ['<a href="https://a.b"><a href="https://a.b">x</a></a>', 'text_nested_link'],
        ['<i/>', 'text_malformed_tag'],
    ])('%s → %s', (input, key) => {
        expect(errorKey(() => sanitizeCommentHtml(input))).toBe(key);
    });
});

describe('sanitizeCommentHtml — граничные случаи', () => {
    it('пустая строка → пустая строка', () => {
        expect(sanitizeCommentHtml('')).toBe('');
    });

    it('CRLF и CR нормализуются в LF', () => {
        expect(sanitizeCommentHtml('a\r\nb\rc')).toBe('a\nb\nc');
    });

    it('кавычки и апострофы в тексте экранируются', () => {
        expect(sanitizeCommentHtml(`"q" 'a' & <`)).toBe('&quot;q&quot; &#39;a&#39; &amp; &lt;');
    });

    it('«<» в самом конце строки', () => {
        expect(sanitizeCommentHtml('a <')).toBe('a &lt;');
    });

    it('вложенность разных тегов в правильном порядке', () => {
        expect(sanitizeCommentHtml('<strong><i><code>x</code></i></strong>')).toBe('<strong><i><code>x</code></i></strong>');
    });

    it('ссылка внутри форматирования и наоборот', () => {
        expect(sanitizeCommentHtml('<i><a href="http://a.b">x</a></i>')).toBe('<i><a href="http://a.b">x</a></i>');
        expect(sanitizeCommentHtml('<a href="http://a.b"><strong>x</strong></a>')).toBe('<a href="http://a.b"><strong>x</strong></a>');
    });

    it('пробелы внутри тегов и атрибутов допускаются и нормализуются', () => {
        expect(sanitizeCommentHtml('<a  href = "https://a.b"  title = "t" >x</a >')).toBe('<a href="https://a.b" title="t">x</a>');
    });

    it('кавычки и & в title экранируются', () => {
        expect(sanitizeCommentHtml(`<a href="https://a.b" title='a "b" & c'>x</a>`)).toBe(
            '<a href="https://a.b" title="a &quot;b&quot; &amp; c">x</a>',
        );
    });

    it('< и > внутри значения атрибута — некорректный тег', () => {
        expect(() => sanitizeCommentHtml(`<a href="https://a.b" title='"><script>'>x</a>`)).toThrow('text_malformed_tag');
    });

    it('href с пробелами по краям обрезается', () => {
        expect(sanitizeCommentHtml('<a href="  https://a.b  ">x</a>')).toBe('<a href="https://a.b">x</a>');
    });

    it.each([
        ['<a href="https://a.b" href="https://c.d">x</a>', 'text_attribute_duplicated:a.href'],
        ['<a href="https://a b">x</a>', 'text_unsafe_url'],
        ['<a href="ftp://a.b">x</a>', 'text_unsafe_url'],
        ['<a href="//a.b">x</a>', 'text_unsafe_url'],
        ['<a href="data:text/html,x">x</a>', 'text_unsafe_url'],
        ['</div>', 'text_tag_not_allowed:div'],
        ['<b>x</b>', 'text_tag_not_allowed:b'],
        ['<i>a<strong>b</i></strong>', 'text_unexpected_closing_tag:i'],
        ['<code>', 'text_tag_not_closed:code'],
        ['<i title="x">a</i>', 'text_attribute_not_allowed:i.title'],
        ['<a href=https://a.b>x</a>', 'text_malformed_tag'],
        ['<i', 'text_malformed_tag'],
    ])('%s → %s', (input, key) => {
        let message: string | null = null;
        try {
            sanitizeCommentHtml(input);
        } catch (e: any) {
            message = e.message;
            expect(e.getStatus()).toBe(400);
        }
        expect(message).toBe(key);
    });

    it('длинный текст на пределе длины обрабатывается целиком', () => {
        const long = 'a'.repeat(COMMENT_TEXT_MAX_LENGTH);
        expect(sanitizeCommentHtml(long)).toHaveLength(COMMENT_TEXT_MAX_LENGTH);
    });
});

describe('escapeHtml / getCommentPlainText', () => {
    it('escapeHtml экранирует все пять символов', () => {
        expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
    });

    it('getCommentPlainText убирает теги и пробелы по краям', () => {
        expect(getCommentPlainText('  <i>a</i> <strong>b</strong>  ')).toBe('a b');
        expect(getCommentPlainText('<i></i>')).toBe('');
    });
});
