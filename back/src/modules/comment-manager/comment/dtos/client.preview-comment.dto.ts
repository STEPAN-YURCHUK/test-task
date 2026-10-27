import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsCommentHtml } from 'src/shared/validations/comment-html.validation';
import { COMMENT_TEXT_MAX_LENGTH } from 'src/shared/utils/comment-html.util';

export class ClientPreviewCommentDto {
    @ApiProperty({ example: 'Hello <i>world</i>', maxLength: COMMENT_TEXT_MAX_LENGTH })
    @IsNotEmpty({ message: 'is_not_empty' })
    @IsString({ message: 'is_string' })
    @MaxLength(COMMENT_TEXT_MAX_LENGTH, { message: 'max_length_5000' })
    @IsCommentHtml()
    readonly text: string;
}
