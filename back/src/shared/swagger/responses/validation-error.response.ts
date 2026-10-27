import { ApiProperty } from '@nestjs/swagger';

// Ответ 400 при ошибке валидации DTO: ключи — поля, значения — локализованные сообщения
export class ValidationErrorResponse {
    @ApiProperty({ example: 400 })
    status: number;

    @ApiProperty({ example: 'not_valid_data', description: 'i18n key' })
    code: string;

    @ApiProperty({ example: 'Validation failed', description: 'Localized by Accept-Language' })
    message: string;

    @ApiProperty({
        example: { userName: ['Only latin letters and digits are allowed'], email: ['Invalid e-mail format'] },
        description: 'Field → localized messages',
        type: 'object',
        additionalProperties: { type: 'array', items: { type: 'string' } },
    })
    errors: Record<string, string[]>;
}
