import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import { VIDEO_SOURCE_MAX_BYTES } from '../constants/file.const';

export class InitFileUploadDto {
    @ApiProperty({ example: 'photo.png', maxLength: 255 })
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsNotEmpty({ message: 'is_not_empty' })
    @IsString({ message: 'is_string' })
    @MaxLength(255, { message: 'max_length_255' })
    readonly filename: string;

    @ApiProperty({ example: 2097152, description: 'File size in bytes' })
    @IsInt({ message: 'is_int' })
    @Min(1, { message: 'min' })
    @Max(VIDEO_SOURCE_MAX_BYTES, { message: 'max' })
    readonly size: number;
}
