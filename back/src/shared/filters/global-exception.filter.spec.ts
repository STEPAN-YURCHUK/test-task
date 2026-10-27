import { BadRequestException, HttpException, HttpStatus, Logger, PayloadTooLargeException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './global-exception.filter';

const translations: Record<string, Record<string, string>> = {
    ru: { 'errors.captcha_invalid': 'Неверная CAPTCHA', 'errors.not_valid_data': 'Ошибка валидации', 'errors.is_email': 'Неверный e-mail' },
    en: { 'errors.captcha_invalid': 'Wrong CAPTCHA', 'errors.internal_server_error': 'Internal server error' },
};

// i18n возвращает сам ключ, если перевода нет — как настоящий nestjs-i18n
const i18n: any = { translate: jest.fn((key: string, { lang }) => translations[lang]?.[key] ?? key) };

const run = (exception: unknown, lang?: string) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host: any = {
        switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => (lang ? { i18nLang: lang } : undefined) }),
    };
    new GlobalExceptionFilter(i18n).catch(exception, host);
    return { code: status.mock.calls[0][0], body: json.mock.calls[0][0] };
};

describe('GlobalExceptionFilter', () => {
    beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    it('i18n-ключ локализуется, code сохраняется', () => {
        expect(run(new HttpException('captcha_invalid', 400), 'ru')).toEqual({
            code: 400,
            body: { status: 400, code: 'captcha_invalid', message: 'Неверная CAPTCHA' },
        });
    });

    it('без языка — en', () => {
        expect(run(new HttpException('captcha_invalid', 400)).body.message).toBe('Wrong CAPTCHA');
    });

    it('нет перевода — сообщение равно ключу', () => {
        expect(run(new HttpException('some_unknown_key', 404), 'ru').body).toEqual({
            status: 404,
            code: 'some_unknown_key',
            message: 'some_unknown_key',
        });
    });

    it("'key:detail' — деталь дописывается к переводу", () => {
        expect(run(new HttpException('captcha_invalid:abc', 400), 'ru').body).toEqual({
            status: 400,
            code: 'captcha_invalid',
            message: 'Неверная CAPTCHA: abc',
        });
    });

    it('свободный текст — без code', () => {
        expect(run(new HttpException('Something Went Wrong', 409)).body).toEqual({ status: 409, message: 'Something Went Wrong' });
    });

    it('объект-ответ с message', () => {
        expect(run(new HttpException({ message: 'captcha_invalid' }, 400), 'en').body.code).toBe('captcha_invalid');
    });

    it('объект-ответ без message → пустое сообщение', () => {
        expect(run(new HttpException({ foo: 1 }, 418)).body).toEqual({ status: 418, message: '' });
    });

    it('ThrottlerException → 429', () => {
        expect(run(new ThrottlerException())).toEqual({
            code: 429,
            body: { status: 429, code: 'too_many_request', message: 'too_many_request' },
        });
    });

    it('413 от multer → file_too_large', () => {
        expect(run(new PayloadTooLargeException('File too large')).body).toEqual({
            status: 413,
            code: 'file_too_large',
            message: 'file_too_large',
        });
    });

    it('неизвестная ошибка → 500 и лог', () => {
        const result = run(new Error('boom'));
        expect(result).toEqual({ code: 500, body: { status: 500, code: 'internal_server_error', message: 'Internal server error' } });
        expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('ошибки валидации агрегируются, вложенные — через точку, локализуются', () => {
        const errors = [
            { property: 'email', constraints: { isEmail: 'is_email', isNotEmpty: 'is_not_empty' } },
            { property: 'email', constraints: { maxLength: 'max_length_255' } },
            { property: 'user', children: [{ property: 'name', constraints: { isString: 'is_string' } }] },
            { property: 'empty' },
        ];
        const result = run(new BadRequestException({ message: 'not_valid_data', errors }), 'ru');
        expect(result.code).toBe(HttpStatus.BAD_REQUEST);
        expect(result.body).toEqual({
            status: 400,
            code: 'not_valid_data',
            message: 'Ошибка валидации',
            errors: { email: ['Неверный e-mail', 'is_not_empty', 'max_length_255'], 'user.name': ['is_string'] },
        });
    });
});
