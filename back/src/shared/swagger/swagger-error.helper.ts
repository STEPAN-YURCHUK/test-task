import { ApiResponseOptions } from '@nestjs/swagger';

// Тексты ошибок (en) для примеров — тот же файл, что локализует ответы в рантайме.
// Копируется в dist через nest-cli assets (shared/localization/locales/**/*)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const errorMessages: Record<string, string> = require('../localization/locales/en/errors.json');

/**
 * Пример ошибки для конкретной ручки — та же форма, что отдаёт GlobalExceptionFilter:
 * `{ status, code, message }`, где `code` — i18n-ключ, а `message` уже локализован.
 */
export function errorExample(status: number, code: string): ApiResponseOptions {
    const example = { status, code, message: errorMessages[code] ?? code };
    return {
        schema: {
            type: 'object',
            properties: {
                status: { type: 'number', example: status },
                code: { type: 'string', example: code },
                message: { type: 'string', example: example.message },
            },
            example,
        },
    };
}

/** Несколько возможных ошибок с одним статусом — Scalar показывает их выпадающим списком примеров */
export function errorExamples(status: number, codes: string[]): ApiResponseOptions {
    return {
        content: {
            'application/json': {
                examples: Object.fromEntries(
                    codes.map((code) => [
                        code,
                        { summary: errorMessages[code] ?? code, value: { status, code, message: errorMessages[code] ?? code } },
                    ]),
                ),
            },
        },
    };
}
