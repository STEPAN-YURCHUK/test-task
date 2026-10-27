import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
    ApiClientFindMyVotesDocs,
    ApiClientIssueVoterTokenDocs,
    ApiClientVoteCommentDocs,
} from '../docs/decorators/client.comment-vote.swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ClientFindMyVotesDto } from '../dtos/client.find-my-votes.dto';
import { ClientVoteCommentDto } from '../dtos/client.vote-comment.dto';
import { VoterAuthGuard } from '../guards/voter-auth.guard';
import { ClientCommentVoteService } from '../services/client.comment-vote.service';
import { ClientVoteCommentInput } from '../types/client.vote-comment-input.type';

@ApiTags('[Client] Comment Vote')
@Controller('comments')
export class ClientCommentVoteController {
    constructor(private readonly clientCommentVoteService: ClientCommentVoteService) {}

    @ApiClientIssueVoterTokenDocs()
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @Post('voters')
    issueVoterToken() {
        return this.clientCommentVoteService.issueVoterToken();
    }

    @ApiClientFindMyVotesDocs()
    @UseGuards(VoterAuthGuard)
    @HttpCode(HttpStatus.OK)
    @Post('votes/my')
    async findMyVotes(@Body() dto: ClientFindMyVotesDto, @Req() req) {
        return await this.clientCommentVoteService.findMyVotes(req.voter.voterId, dto.uuids);
    }

    @ApiClientVoteCommentDocs()
    @UseGuards(VoterAuthGuard, ThrottlerGuard)
    @Throttle({ default: { limit: 60, ttl: 60_000 } })
    @Put(':commentUuid/vote')
    async vote(@Param('commentUuid', ParseUUIDPipe) commentUuid: string, @Body() dto: ClientVoteCommentDto, @Req() req) {
        const input = {
            commentUuid,
            voterId: req.voter.voterId,
            value: dto.value,
        } satisfies ClientVoteCommentInput;

        return await this.clientCommentVoteService.vote(input);
    }
}
