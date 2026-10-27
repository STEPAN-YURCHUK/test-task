import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { getCommentPlainText, sanitizeCommentHtml } from '../utils/comment-html.util';

@ValidatorConstraint({ name: 'isCommentHtml', async: false })
export class IsCommentHtmlConstraint implements ValidatorConstraintInterface {
    validate(value: unknown) {
        if (typeof value !== 'string') return false;
        try {
            return getCommentPlainText(sanitizeCommentHtml(value)).length > 0;
        } catch {
            return false;
        }
    }

    // ключ ошибки санитайзера ('text_tag_not_closed:i' → 'text_tag_not_closed'), иначе — пустой текст
    defaultMessage(args: ValidationArguments) {
        try {
            sanitizeCommentHtml(String(args.value ?? ''));
            return 'text_empty';
        } catch (e: any) {
            return String(e.message).split(':')[0];
        }
    }
}

export function IsCommentHtml(validationOptions?: ValidationOptions) {
    return (object: object, propertyName: string) => {
        registerDecorator({
            target: object.constructor,
            propertyName,
            options: validationOptions,
            validator: IsCommentHtmlConstraint,
        });
    };
}
