import { JwtService } from '@nestjs/jwt';
import { JwtTokenService } from 'src/infrastructure/jwt-token/services/jwt-token.service';
import { COMMENT_VOTE_EVENTS } from '../constants/comment-vote-events.const';
import { ClientCommentVoteService } from './client.comment-vote.service';

const setup = (existing: { uuid: string; value: number } | null, counters = { likesCount: 5, dislikesCount: 2, rating: 3 }) => {
    const trx = { id: 'trx' };
    const repository = {
        lockComment: jest.fn(),
        findOne: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        incrementCounters: jest.fn(),
        findCounters: jest.fn().mockResolvedValue(counters),
        findAllByVoter: jest.fn(),
    };
    const errorService = { checkExists: jest.fn() };
    const database = { withTransaction: jest.fn((_c, fn) => fn(trx)) };
    const events = { emit: jest.fn() };
    process.env.JWT_VOTER_SECRET = 'voter-secret';
    const jwt = new JwtTokenService(new JwtService());
    const service = new ClientCommentVoteService(repository as any, errorService as any, jwt, database as any, events as any);
    return { service, repository, errorService, events, trx, jwt };
};

describe('ClientCommentVoteService', () => {
    it('issueVoterToken — валидный токен со случайным voterId', () => {
        const { service, jwt } = setup(null);
        const a = jwt.verifyVoterToken(service.issueVoterToken().token);
        const b = jwt.verifyVoterToken(service.issueVoterToken().token);
        expect(a.voterId).toMatch(/^[0-9a-f-]{36}$/);
        expect(a.voterId).not.toBe(b.voterId);
    });

    it.each([
        ['0 → like', null, 1, 'create', { likesCount: 1, dislikesCount: 0, rating: 1 }],
        ['0 → dislike', null, -1, 'create', { likesCount: 0, dislikesCount: 1, rating: -1 }],
        ['like → dislike', { uuid: 'v', value: 1 }, -1, 'update', { likesCount: -1, dislikesCount: 1, rating: -2 }],
        ['dislike → like', { uuid: 'v', value: -1 }, 1, 'update', { likesCount: 1, dislikesCount: -1, rating: 2 }],
        ['like → снять', { uuid: 'v', value: 1 }, 0, 'delete', { likesCount: -1, dislikesCount: 0, rating: -1 }],
        ['dislike → снять', { uuid: 'v', value: -1 }, 0, 'delete', { likesCount: 0, dislikesCount: -1, rating: 1 }],
    ])('%s: %s и дельта счётчиков', async (_, existing, value, action, deltas) => {
        const { service, repository, errorService, trx, events } = setup(existing);
        const result = await service.vote({ commentUuid: 'c1', voterId: 'voter', value: value as any });

        expect(errorService.checkExists).toHaveBeenCalledWith('c1', trx);
        expect(repository.lockComment).toHaveBeenCalledWith('c1', trx);
        if (action === 'create') expect(repository.create).toHaveBeenCalledWith('c1', 'voter', value, trx);
        if (action === 'update') expect(repository.update).toHaveBeenCalledWith('v', value, trx);
        if (action === 'delete') expect(repository.delete).toHaveBeenCalledWith('v', trx);
        expect(repository.incrementCounters).toHaveBeenCalledWith('c1', deltas, trx);
        expect(events.emit).toHaveBeenCalledWith(COMMENT_VOTE_EVENTS.VOTED, {
            commentUuid: 'c1',
            likesCount: 5,
            dislikesCount: 2,
            rating: 3,
        });
        expect(result).toEqual({ likesCount: 5, dislikesCount: 2, rating: 3, myVote: value });
    });

    it.each([
        ['like → like', { uuid: 'v', value: 1 }, 1],
        ['dislike → dislike', { uuid: 'v', value: -1 }, -1],
        ['нет голоса → снять', null, 0],
    ])('%s — ничего не меняет', async (_, existing, value) => {
        const { service, repository } = setup(existing);
        await service.vote({ commentUuid: 'c1', voterId: 'voter', value: value as any });
        expect(repository.create).not.toHaveBeenCalled();
        expect(repository.update).not.toHaveBeenCalled();
        expect(repository.delete).not.toHaveBeenCalled();
        expect(repository.incrementCounters).not.toHaveBeenCalled();
    });

    it('несуществующий комментарий — ошибка до блокировки', async () => {
        const { service, repository, errorService, events } = setup(null);
        errorService.checkExists.mockRejectedValue(new Error('comment_not_found'));
        await expect(service.vote({ commentUuid: 'x', voterId: 'v', value: 1 })).rejects.toThrow('comment_not_found');
        expect(repository.lockComment).not.toHaveBeenCalled();
        expect(events.emit).not.toHaveBeenCalled();
    });

    it('findMyVotes → словарь uuid → value', async () => {
        const { service, repository } = setup(null);
        repository.findAllByVoter.mockResolvedValue([
            { commentUuid: 'a', value: 1 },
            { commentUuid: 'b', value: -1 },
        ]);
        expect(await service.findMyVotes('voter', ['a', 'b', 'c'])).toEqual({ a: 1, b: -1 });
        expect(repository.findAllByVoter).toHaveBeenCalledWith('voter', ['a', 'b', 'c']);
    });
});
