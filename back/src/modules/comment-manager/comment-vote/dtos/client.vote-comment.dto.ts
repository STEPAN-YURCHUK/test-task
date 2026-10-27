import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt } from 'class-validator';

export class ClientVoteCommentDto {
    @ApiProperty({ enum: [1, -1, 0], description: '1 — like, -1 — dislike, 0 — remove vote' })
    @IsInt({ message: 'is_int' })
    @IsIn([1, -1, 0], { message: 'is_in' })
    readonly value: 1 | -1 | 0;
}
