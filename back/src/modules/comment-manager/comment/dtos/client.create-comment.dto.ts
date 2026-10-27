import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, Matches, MaxLength } from 'class-validator';
import { IsCommentHtml } from 'src/shared/validations/comment-html.validation';
import { COMMENT_TEXT_MAX_LENGTH } from 'src/shared/utils/comment-html.util';

const trim = ({ value }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : trim({ value }));

export class ClientCreateCommentDto {
    @ApiProperty({ example: 'John2024', description: 'Latin letters and digits only', maxLength: 50 })
    @Transform(trim)
    @IsNotEmpty({ message: 'is_not_empty' })
    @IsString({ message: 'is_string' })
    @MaxLength(50, { message: 'max_length_50' })
    @Matches(/^[A-Za-z0-9]+$/, { message: 'user_name_alphanumeric' })
    readonly userName: string;

    @ApiProperty({ example: 'john@example.com', maxLength: 255 })
    @Transform(trim)
    @IsNotEmpty({ message: 'is_not_empty' })
    @MaxLength(255, { message: 'max_length_255' })
    @IsEmail({}, { message: 'is_email' })
    readonly email: string;

    @ApiProperty({ example: 'https://example.com', required: false, maxLength: 2048 })
    @Transform(emptyToUndefined)
    @IsOptional()
    @MaxLength(2048, { message: 'max_length_2048' })
    @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'is_url' })
    readonly homePage?: string;

    @ApiProperty({
        example: 'Hello <strong>world</strong>, see <a href="https://example.com" title="ex">this</a>',
        description: 'Allowed tags: <a href title>, <code>, <i>, <strong>. Tags must be properly closed.',
        maxLength: COMMENT_TEXT_MAX_LENGTH,
    })
    @IsNotEmpty({ message: 'is_not_empty' })
    @IsString({ message: 'is_string' })
    @MaxLength(COMMENT_TEXT_MAX_LENGTH, { message: 'max_length_5000' })
    @IsCommentHtml()
    readonly text: string;

    @ApiProperty({ required: false, description: 'Comment being replied to' })
    @Transform(emptyToUndefined)
    @IsOptional()
    @IsUUID('4', { message: 'is_uuid' })
    readonly parentUuid?: string;

    @ApiProperty({ required: false, description: 'READY upload from POST /uploads (direct S3 upload). Alternative to `file`' })
    @Transform(emptyToUndefined)
    @IsOptional()
    @IsUUID('4', { message: 'is_uuid' })
    readonly uploadId?: string;

    @ApiProperty({ description: 'Token from GET /captcha' })
    @IsNotEmpty({ message: 'is_not_empty' })
    @IsString({ message: 'is_string' })
    readonly captchaToken: string;

    @ApiProperty({ example: 'aB3dE9', description: 'Text from the CAPTCHA image' })
    @Transform(trim)
    @IsNotEmpty({ message: 'is_not_empty' })
    @MaxLength(10, { message: 'max_length_10' })
    @Matches(/^[A-Za-z0-9]+$/, { message: 'captcha_alphanumeric' })
    readonly captcha: string;

    @ApiProperty({
        type: 'string',
        format: 'binary',
        required: false,
        description: 'Legacy: JPG/GIF/PNG (resized to 320x240) or TXT up to 100 KB in the request itself. Prefer uploadId',
    })
    readonly file?: unknown;
}
