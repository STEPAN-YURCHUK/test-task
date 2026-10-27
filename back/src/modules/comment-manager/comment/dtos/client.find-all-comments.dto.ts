import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SortFieldCommentEnum } from '../enums/sort-field-comment.enum';
import { SortOrderEnum } from '../enums/sort-order.enum';

export class ClientFindAllCommentsDto {
    @ApiProperty({ required: false, example: 1, default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt({ message: 'is_int' })
    @Min(1, { message: 'min' })
    @Max(100_000, { message: 'max' })
    readonly page?: number;

    @ApiProperty({ required: false, enum: SortFieldCommentEnum, default: SortFieldCommentEnum.CREATED_AT })
    @IsOptional()
    @IsEnum(SortFieldCommentEnum, { message: 'is_enum' })
    readonly sortBy?: SortFieldCommentEnum;

    @ApiProperty({ required: false, enum: SortOrderEnum, default: SortOrderEnum.DESC })
    @IsOptional()
    @IsEnum(SortOrderEnum, { message: 'is_enum' })
    readonly sortOrder?: SortOrderEnum;
}
