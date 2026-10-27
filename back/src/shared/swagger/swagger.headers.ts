import { applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

// Язык сообщений ошибок: Accept-Language или ?lang=, по умолчанию en
export const ApiAcceptLanguageHeader = () =>
    applyDecorators(
        ApiHeader({
            name: 'Accept-Language',
            required: false,
            description: 'Language of error messages: `en` (default) or `ru`. Also accepted as the `?lang=` query parameter.',
            schema: { type: 'string', enum: ['en', 'ru'], default: 'en' },
        }),
    );
