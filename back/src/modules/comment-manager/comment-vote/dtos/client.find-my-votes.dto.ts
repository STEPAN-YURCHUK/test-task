import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class ClientFindMyVotesDto {
    @ApiProperty({ type: [String], description: 'Comment uuids visible on the page', maxItems: 1000 })
    @IsArray({ message: 'is_array' })
    @ArrayMaxSize(1000, { message: 'array_max_size' })
    @IsUUID('4', { each: true, message: 'is_uuid' })
    readonly uuids: string[];
}
