import { applyDecorators } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiConsumes,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiPayloadTooLargeResponse,
    ApiTooManyRequestsResponse,
    ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ValidationErrorResponse } from 'src/shared/swagger/responses/validation-error.response';
import { errorExample, errorExamples } from 'src/shared/swagger/swagger-error.helper';
import { ApiAcceptLanguageHeader } from 'src/shared/swagger/swagger.headers';
import { CommentListResponse, CommentPreviewResponse, CommentResponse } from '../responses/comment.response';

export const ApiClientFindAllCommentsDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'List top-level comments',
            description:
                '25 top-level comments per page with **all** replies of each thread in `replies` (flat, oldest first — build the tree by `parentUuid`). ' +
                'Default order is newest first (LIFO). Read from Meilisearch; if it is unavailable — from Postgres with the same result.',
        }),
        ApiOkResponse({ description: 'Page of comments', type: CommentListResponse }),
        ApiBadRequestResponse({ description: 'Invalid page / sortBy / sortOrder', type: ValidationErrorResponse }),
        ApiAcceptLanguageHeader(),
    );

export const ApiClientPreviewCommentDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Preview message text',
            description:
                'Validates the text with the same rules as `POST /comments` and returns the HTML that would be stored. Nothing is saved.',
        }),
        ApiOkResponse({ description: 'Rendered text', type: CommentPreviewResponse }),
        ApiBadRequestResponse({ description: 'Disallowed tag, unclosed tag, unsafe link…', type: ValidationErrorResponse }),
        ApiAcceptLanguageHeader(),
    );

export const ApiClientFindOneCommentDocs = () =>
    applyDecorators(
        ApiOperation({ summary: 'Get one comment' }),
        ApiOkResponse({ description: 'Comment', type: CommentResponse }),
        ApiBadRequestResponse({ description: '`commentUuid` is not a uuid', ...errorExample(400, 'is_uuid') }),
        ApiNotFoundResponse({ description: 'Comment not found', ...errorExample(404, 'comment_not_found') }),
        ApiAcceptLanguageHeader(),
    );

export const ApiClientCreateCommentDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Post a comment or a reply',
            description:
                '`multipart/form-data`. Requires a fresh CAPTCHA from `GET /captcha`. Pass `parentUuid` to reply. ' +
                'Attachment: either `uploadId` of a `READY` direct upload (recommended, any type) or `file` in the request itself (images/TXT ≤ 5 MB) — not both. ' +
                'The new comment is also pushed to every client over WebSocket (`comment_created`). Limited to 10 requests per minute per IP.',
        }),
        ApiConsumes('multipart/form-data'),
        ApiCreatedResponse({ description: 'Comment created', type: CommentResponse }),
        ApiBadRequestResponse({
            description:
                'Validation failed (`not_valid_data` with `errors`), temporary (disposable) e-mail, wrong/expired CAPTCHA, bad file or `file` together with `uploadId`',
            ...errorExamples(400, [
                'not_valid_data',
                'disposable_email_not_allowed',
                'captcha_invalid',
                'captcha_expired',
                'conflicting_file_sources',
                'file_type_not_allowed',
                'file_text_too_large',
            ]),
        }),
        ApiNotFoundResponse({
            description: 'Upload not found, expired or already attached',
            ...errorExample(404, 'file_upload_not_found'),
        }),
        ApiConflictResponse({ description: 'Upload is not processed yet or failed', ...errorExample(409, 'file_upload_not_ready') }),
        ApiPayloadTooLargeResponse({ description: '`file` bigger than 5 MB', ...errorExample(413, 'file_too_large') }),
        ApiUnprocessableEntityResponse({
            description: 'Parent comment does not exist, or the file content is broken',
            ...errorExamples(422, ['parent_comment_not_found', 'file_image_invalid', 'file_text_invalid']),
        }),
        ApiTooManyRequestsResponse({
            description: 'More than 10 comments per minute from this IP',
            ...errorExample(429, 'too_many_request'),
        }),
        ApiAcceptLanguageHeader(),
    );
