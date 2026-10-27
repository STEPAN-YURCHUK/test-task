import { ApiProperty } from '@nestjs/swagger';

export class UploadPartUrlResponse {
    @ApiProperty({ example: 1 })
    partNumber: number;

    @ApiProperty({
        example: 5242880,
        description: 'Exact byte size of this part (it is signed — the S3 PUT must send exactly this many bytes)',
    })
    size: number;

    @ApiProperty({
        example: 'https://ams3.digitaloceanspaces.com/bucket/comments/prod/uploads/…/source.png?partNumber=1&uploadId=…&X-Amz-Signature=…',
        description: 'Presigned S3 URL: `PUT` the part bytes here (directly to S3, not to the API)',
    })
    url: string;
}

export class UploadInitResponse {
    @ApiProperty({
        example: '9a7c1f4e-2b3d-4c5e-8f9a-0b1c2d3e4f50',
        description: 'Upload session id; after `READY` pass it as `uploadId` to `POST /comments`',
    })
    uploadId: string;

    @ApiProperty({ example: 5242880, description: 'Part size (5 MiB); the last part is smaller' })
    partSize: number;

    @ApiProperty({ example: 3600, description: 'Seconds the part URLs stay valid' })
    expiresIn: number;

    @ApiProperty({ type: [UploadPartUrlResponse] })
    parts: UploadPartUrlResponse[];
}

export class UploadedFileResponse {
    @ApiProperty({ enum: ['IMAGE', 'TEXT', 'VIDEO'], example: 'IMAGE' })
    type: string;

    @ApiProperty({ example: 'https://cdn.example.com/comments/prod/files/images/original/9a7c….png' })
    url: string;

    @ApiProperty({ example: 'photo.png' })
    originalName: string;

    @ApiProperty({ example: 'image/png' })
    mimeType: string;

    @ApiProperty({ example: 6884 })
    size: number;

    @ApiProperty({ example: 320, nullable: true, type: Number })
    width: number | null;

    @ApiProperty({ example: 213, nullable: true, type: Number })
    height: number | null;

    @ApiProperty({
        example: 'https://cdn.example.com/comments/prod/files/images/webp-original/9a7c….webp',
        nullable: true,
        type: String,
        description: 'Images only',
    })
    webpUrl: string | null;

    @ApiProperty({ example: null, nullable: true, type: String, description: 'Videos only — WebP poster frame' })
    posterUrl: string | null;

    @ApiProperty({ example: null, nullable: true, type: Number, description: 'Videos only — seconds' })
    duration: number | null;
}

export class UploadStatusResponse {
    @ApiProperty({ example: '9a7c1f4e-2b3d-4c5e-8f9a-0b1c2d3e4f50' })
    uploadId: string;

    @ApiProperty({
        enum: ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'],
        example: 'READY',
        description: '`PROCESSING` — poll again in ~1 s (videos may take minutes)',
    })
    status: string;

    @ApiProperty({
        example: null,
        nullable: true,
        type: String,
        description:
            'i18n key when `FAILED`: `file_image_invalid`, `file_text_invalid`, `file_video_invalid`, `file_video_too_long`, `file_processing_failed`',
    })
    error: string | null;

    @ApiProperty({ type: UploadedFileResponse, nullable: true, description: 'Present when `READY`' })
    file: UploadedFileResponse | null;
}
