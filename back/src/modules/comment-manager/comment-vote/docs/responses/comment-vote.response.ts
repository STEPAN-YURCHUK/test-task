import { ApiProperty } from '@nestjs/swagger';

export class VoterTokenResponse {
    @ApiProperty({
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2b3RlcklkIjoi…',
        description: 'Anonymous voter JWT (random `voterId`), lives 365 days. Store it on the client',
    })
    token: string;
}

export class VoteResultResponse {
    @ApiProperty({ example: 4 })
    likesCount: number;

    @ApiProperty({ example: 1 })
    dislikesCount: number;

    @ApiProperty({ example: 3, description: 'likesCount − dislikesCount; `sortBy=rating` orders by it' })
    rating: number;

    @ApiProperty({ enum: [1, -1, 0], example: 1, description: 'Your vote after the request' })
    myVote: 1 | -1 | 0;
}
