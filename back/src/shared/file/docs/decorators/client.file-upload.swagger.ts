import { applyDecorators } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { errorExample, errorExamples } from 'src/shared/swagger/swagger-error.helper';
import { ApiAcceptLanguageHeader } from 'src/shared/swagger/swagger.headers';
import { UploadInitResponse, UploadStatusResponse } from '../responses/file-upload.response';

const UnknownUploadResponses = () =>
    applyDecorators(
        ApiBadRequestResponse({ description: '`uploadId` is not a uuid', ...errorExample(400, 'is_uuid') }),
        ApiNotFoundResponse({
            description: 'Upload not found or expired (sessions live 24 hours)',
            ...errorExample(404, 'file_upload_not_found'),
        }),
        ApiAcceptLanguageHeader(),
    );

export const ApiClientInitUploadDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Start a direct upload',
            description:
                'Creates an S3 multipart upload and returns a presigned `PUT` URL for every 5 MiB part. Upload the parts **directly to S3** (in parallel, retrying failed ones), then call `complete`. ' +
                'Allowed: jpg, jpeg, png, gif (≤ 20 MB), txt (≤ 100 KB), mp4, m4v, mov, webm, mkv, avi (≤ 200 MB). Limited to 20 per minute per IP.',
        }),
        ApiCreatedResponse({ description: 'Upload session and part URLs', type: UploadInitResponse }),
        ApiBadRequestResponse({
            description: 'Not allowed type or too big',
            ...errorExamples(400, [
                'file_type_not_allowed',
                'file_image_too_large',
                'file_text_too_large',
                'file_video_too_large',
                'not_valid_data',
            ]),
        }),
        ApiTooManyRequestsResponse({ description: 'Too many uploads from this IP', ...errorExample(429, 'too_many_request') }),
        ApiAcceptLanguageHeader(),
    );

export const ApiClientRefreshUploadPartsDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Re-sign part URLs',
            description: 'Part URLs expire after an hour — get fresh ones for a long upload or a retry.',
        }),
        ApiOkResponse({ description: 'Fresh part URLs', type: UploadInitResponse }),
        ApiConflictResponse({ description: 'Upload is already completed', ...errorExample(409, 'file_upload_not_ready') }),
        UnknownUploadResponses(),
    );

export const ApiClientCompleteUploadDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Complete the upload',
            description:
                'Checks in S3 that every part arrived with the declared size, assembles the file and queues processing (resize + WebP / H.264 conversion). Returns `PROCESSING`; repeated calls are safe.',
        }),
        ApiOkResponse({ description: 'Upload status (usually `PROCESSING`)', type: UploadStatusResponse }),
        ApiConflictResponse({ description: 'Not all parts were uploaded or sizes differ', ...errorExample(409, 'file_upload_incomplete') }),
        UnknownUploadResponses(),
    );

export const ApiClientUploadStatusDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Upload status',
            description: 'Poll until `READY` (then use `uploadId` in `POST /comments`) or `FAILED` (see `error`).',
        }),
        ApiOkResponse({ description: 'Upload status', type: UploadStatusResponse }),
        UnknownUploadResponses(),
    );

export const ApiClientAbortUploadDocs = () =>
    applyDecorators(
        ApiOperation({
            summary: 'Cancel the upload',
            description: 'Aborts the S3 multipart upload and deletes processed results. Idempotent: an unknown id also returns 204.',
        }),
        ApiNoContentResponse({ description: 'Cancelled' }),
        ApiBadRequestResponse({ description: '`uploadId` is not a uuid', ...errorExample(400, 'is_uuid') }),
    );
