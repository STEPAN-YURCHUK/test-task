import { IsNotEmpty, validate } from 'class-validator';
import { IsCommentHtml, IsCommentHtmlConstraint } from './comment-html.validation';

class Dto {
    @IsNotEmpty()
    @IsCommentHtml()
    text: any;
}

const check = async (text: unknown) => {
    const dto = new Dto();
    dto.text = text;
    const [error] = await validate(dto);
    return error?.constraints?.isCommentHtml ?? null;
};

describe('IsCommentHtml', () => {
    const constraint = new IsCommentHtmlConstraint();

    it.each([
        ['обычный текст', 'hello'],
        ['разрешённые теги', '<i>a</i> <strong>b</strong> <code>c</code> <a href="https://x.io" title="t">d</a>'],
    ])('валидно: %s', async (_, text) => {
        expect(await check(text)).toBeNull();
    });

    it.each([
        ['не строка', 123, 'text_empty'],
        ['только теги без текста', '<i></i>', 'text_empty'],
        ['пробелы', '   ', 'text_empty'],
        ['запрещённый тег', '<script>x</script>', 'text_tag_not_allowed'],
        ['не закрыт', '<i>x', 'text_tag_not_closed'],
        ['javascript: ссылка', '<a href="javascript:alert(1)">x</a>', 'text_unsafe_url'],
    ])('невалидно: %s → %s', async (_, text, key) => {
        expect(await check(text)).toBe(key);
    });

    it('validate напрямую: не строка → false', () => {
        expect(constraint.validate(null)).toBe(false);
    });

    it('defaultMessage с undefined значением', () => {
        expect(constraint.defaultMessage({ value: undefined } as any)).toBe('text_empty');
    });
});
