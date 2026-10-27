import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CommentAuthorResponse {
    @ApiProperty({ example: 'John2024' })
    userName: string;

    @ApiProperty({ example: 'john@example.com', description: 'Stored lower-cased' })
    email: string;

    @ApiProperty({ example: 'https://john.dev', nullable: true, type: String })
    homePage: string | null;
}

export class ImageVariantResponse {
    @ApiProperty({ example: 'https://cdn.example.com/comments/prod/files/images/medium/6f1c….png' })
    url: string;

    @ApiProperty({ example: 'https://cdn.example.com/comments/prod/files/images/webp-medium/6f1c….webp', nullable: true, type: String })
    webpUrl: string | null;

    @ApiProperty({ example: 240 })
    width: number;

    @ApiProperty({ example: 160 })
    height: number;
}

export class ImageVariantsResponse {
    @ApiProperty({ type: ImageVariantResponse, description: '≤ 160×120' })
    small: ImageVariantResponse;

    @ApiProperty({ type: ImageVariantResponse, description: '≤ 240×180' })
    medium: ImageVariantResponse;

    @ApiProperty({ type: ImageVariantResponse, description: '≤ 320×240 (the limit from the spec)' })
    original: ImageVariantResponse;
}

export class VideoMetaResponse {
    @ApiProperty({ example: 12.48, nullable: true, type: Number, description: 'Seconds' })
    duration: number | null;

    @ApiProperty({ example: 'https://cdn.example.com/comments/prod/files/videos/posters/6f1c….jpg' })
    posterUrl: string;

    @ApiProperty({ example: 'https://cdn.example.com/comments/prod/files/videos/posters/6f1c….webp', nullable: true, type: String })
    webpPosterUrl: string | null;
}

export class CommentFileResponse {
    @ApiProperty({ example: '0b3c8f9e-7d1a-4b55-9a3e-2f6c1d9e8a10' })
    uuid: string;

    @ApiProperty({ enum: ['IMAGE', 'TEXT', 'VIDEO'], example: 'IMAGE' })
    type: 'IMAGE' | 'TEXT' | 'VIDEO';

    @ApiProperty({
        example: 'https://cdn.example.com/comments/prod/files/images/original/6f1c….png',
        description: 'CDN URL of the file (for images — the `original` variant; for videos — H.264/AAC MP4)',
    })
    url: string;

    @ApiProperty({ example: 'photo.png' })
    originalName: string;

    @ApiProperty({ example: 'image/png' })
    mimeType: string;

    @ApiProperty({ example: 6884, description: 'Bytes, after processing' })
    size: number;

    @ApiProperty({ example: 320, nullable: true, type: Number, description: 'Displayed width (videos: rotation applied)' })
    width: number | null;

    @ApiProperty({ example: 213, nullable: true, type: Number })
    height: number | null;

    @ApiProperty({ type: ImageVariantsResponse, nullable: true, description: 'Images only — use for `srcset`/`<picture>`' })
    variants: ImageVariantsResponse | null;

    @ApiProperty({ type: VideoMetaResponse, nullable: true, description: 'Videos only' })
    video: VideoMetaResponse | null;
}

export class CommentResponse {
    @ApiProperty({ example: '6f1c2c55-1111-4a4a-9b9b-1234567890ab' })
    uuid: string;

    @ApiProperty({ example: null, nullable: true, type: String, description: 'Direct parent; `null` for a top-level comment' })
    parentUuid: string | null;

    @ApiProperty({
        example: null,
        nullable: true,
        type: String,
        description: 'Top-level comment of the thread; `null` for a top-level comment',
    })
    rootUuid: string | null;

    @ApiProperty({
        example: 'Hello <strong>world</strong>, see <a href="https://example.com" title="ex">this</a>',
        description: 'Canonical, already escaped XHTML — safe to render as HTML',
    })
    text: string;

    @ApiProperty({ example: 3 })
    likesCount: number;

    @ApiProperty({ example: 0 })
    dislikesCount: number;

    @ApiProperty({ example: '2026-10-26T15:34:29.667Z' })
    createdAt: string;

    @ApiProperty({ type: CommentAuthorResponse })
    user: CommentAuthorResponse;

    @ApiProperty({ type: CommentFileResponse, nullable: true })
    file: CommentFileResponse | null;
}

export class TopLevelCommentResponse extends CommentResponse {
    @ApiProperty({
        type: [CommentResponse],
        description: 'All replies of the thread at any depth, oldest first; build the tree by `parentUuid`',
    })
    replies: CommentResponse[];
}

export class CommentListResponse {
    @ApiProperty({ type: [TopLevelCommentResponse] })
    items: TopLevelCommentResponse[];

    @ApiProperty({ example: 300000, description: 'Number of top-level comments' })
    total: number;

    @ApiProperty({ example: 1 })
    page: number;

    @ApiProperty({ example: 25 })
    pageSize: number;

    @ApiProperty({ example: 12000 })
    totalPages: number;
}

export class CommentPreviewResponse {
    @ApiPropertyOptional({
        example: '<i>hi</i> &amp; <a href="https://a.b">l</a>',
        description: 'Exactly what `POST /comments` would store',
    })
    html: string;
}
