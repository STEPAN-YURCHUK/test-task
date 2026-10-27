import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DatabaseService } from 'src/infrastructure/database/services/database.service';
import { JwtTokenService } from 'src/infrastructure/jwt-token/services/jwt-token.service';
import { ClientCommentErrorService } from '../../comment-error/services/client.comment-error.service';
import { COMMENT_VOTE_EVENTS } from '../constants/comment-vote-events.const';
import { ValueCommentVoteEnum } from '../enums/value-comment-vote.enum';
import { ClientCommentVoteRepository } from '../repositories/client.comment-vote.repository';
import { ClientCommentVoteCounters } from '../types/client.comment-vote-counters.type';
import { ClientVoteCommentInput } from '../types/client.vote-comment-input.type';
import { CommentVotedEvent } from '../types/comment-voted-event.type';

const counterDelta = (value: number): ClientCommentVoteCounters => ({
    likesCount: value === ValueCommentVoteEnum.LIKE ? 1 : 0,
    dislikesCount: value === ValueCommentVoteEnum.DISLIKE ? 1 : 0,
    rating: value,
});

@Injectable()
export class ClientCommentVoteService {
    constructor(
        private readonly clientCommentVoteRepository: ClientCommentVoteRepository,
        private readonly clientCommentErrorService: ClientCommentErrorService,
        private readonly jwtTokenService: JwtTokenService,
        private readonly databaseService: DatabaseService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    issueVoterToken() {
        return { token: this.jwtTokenService.generateVoterToken({ voterId: randomUUID() }) };
    }

    // Клиент присылает желаемое состояние (1 / -1 / 0), сервер считает дельту к счётчикам
    async vote(input: ClientVoteCommentInput) {
        const counters = await this.databaseService.withTransaction({}, async (trx) => {
            await this.clientCommentErrorService.checkExists(input.commentUuid, trx);
            await this.clientCommentVoteRepository.lockComment(input.commentUuid, trx);

            const existing = await this.clientCommentVoteRepository.findOne(input.commentUuid, input.voterId, trx);
            const previous = existing?.value ?? 0;

            if (previous !== input.value) {
                if (input.value === 0) await this.clientCommentVoteRepository.delete(existing.uuid, trx);
                else if (!existing) await this.clientCommentVoteRepository.create(input.commentUuid, input.voterId, input.value, trx);
                else await this.clientCommentVoteRepository.update(existing.uuid, input.value, trx);

                const added = counterDelta(input.value);
                const removed = counterDelta(previous);
                await this.clientCommentVoteRepository.incrementCounters(
                    input.commentUuid,
                    {
                        likesCount: added.likesCount - removed.likesCount,
                        dislikesCount: added.dislikesCount - removed.dislikesCount,
                        rating: added.rating - removed.rating,
                    },
                    trx,
                );
            }

            const comment = await this.clientCommentVoteRepository.findCounters(input.commentUuid, trx);
            return { likesCount: comment.likesCount, dislikesCount: comment.dislikesCount, rating: comment.rating };
        });

        this.eventEmitter.emit(COMMENT_VOTE_EVENTS.VOTED, { commentUuid: input.commentUuid, ...counters } satisfies CommentVotedEvent);

        return { ...counters, myVote: input.value };
    }

    async findMyVotes(voterId: string, commentUuids: string[]): Promise<Record<string, number>> {
        const votes = await this.clientCommentVoteRepository.findAllByVoter(voterId, commentUuids);
        return Object.fromEntries(votes.map((vote) => [vote.commentUuid, vote.value]));
    }
}
