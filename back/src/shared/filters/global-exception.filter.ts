import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';
import { I18nService } from 'nestjs-i18n';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    constructor(private readonly i18n: I18nService) {}

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest();
        const language = request?.i18nLang || 'en';

        const status = this.getHttpStatus(exception);
        const errorResponse = exception instanceof HttpException ? exception.getResponse() : exception;

        if (status === HttpStatus.INTERNAL_SERVER_ERROR) this.logger.error(exception);

        response.status(status).json(this.buildErrorResponse(status, errorResponse, language));
    }

    private getHttpStatus(exception: unknown): number {
        if (exception instanceof ThrottlerException) return HttpStatus.TOO_MANY_REQUESTS;
        return exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    }

    private buildErrorResponse(status: number, errorResponse: any, language: string) {
        if (status === HttpStatus.TOO_MANY_REQUESTS) {
            return { status, code: 'too_many_request', message: this.localize('too_many_request', language) };
        }

        if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
            return { status, code: 'file_too_large', message: this.localize('file_too_large', language) };
        }

        if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
            return { status, code: 'internal_server_error', message: this.localize('internal_server_error', language) };
        }

        if (status === HttpStatus.BAD_REQUEST && errorResponse?.errors) {
            return {
                status,
                code: 'not_valid_data',
                message: this.localize('not_valid_data', language),
                errors: this.localizeValidationErrors(this.aggregateValidationErrors(errorResponse.errors), language),
            };
        }

        const raw = typeof errorResponse === 'string' ? errorResponse : String(errorResponse?.message ?? '');
        const [key, detail] = raw.split(':');
        const code = /^[a-z0-9_]+$/.test(key) ? key : null;
        const message = code ? this.localize(code, language) : raw;

        return {
            status,
            ...(code ? { code } : {}),
            message: detail ? `${message}: ${detail}` : message,
        };
    }

    private aggregateValidationErrors(errors: any[]): Record<string, string[]> {
        return errors.reduce((acc, { property, constraints, children }) => {
            if (constraints) acc[property] = [...(acc[property] ?? []), ...Object.values(constraints)];

            if (children?.length) {
                const nested = this.aggregateValidationErrors(children);
                for (const key in nested) acc[`${property}.${key}`] = nested[key];
            }

            return acc;
        }, {});
    }

    private localizeValidationErrors(errors: Record<string, string[]>, language: string): Record<string, string[]> {
        return Object.fromEntries(Object.entries(errors).map(([field, keys]) => [field, keys.map((key) => this.localize(key, language))]));
    }

    private localize(key: string, lang: string): string {
        const translated = this.i18n.translate(`errors.${key}`, { lang }) as string;
        return translated && translated !== `errors.${key}` ? translated : key;
    }
}
