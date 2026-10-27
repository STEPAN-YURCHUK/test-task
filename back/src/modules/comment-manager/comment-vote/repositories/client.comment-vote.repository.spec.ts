import { Op } from 'sequelize';
import { ClientCommentVoteRepository } from './client.comment-vote.repository';

describe('ClientCommentVoteRepository', () => {
    const voteModel = {
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        destroy: jest.fn(),
        findAll: jest.fn().mockResolvedValue(['v']),
    };
    const commentModel = { findOne: jest.fn(), increment: jest.fn() };
    const repository = new ClientCommentVoteRepository(voteModel as any, commentModel as any);
    const trx: any = { LOCK: { UPDATE: 'UPDATE' } };

    beforeEach(() => jest.clearAllMocks());

    it('lockComment — SELECT … FOR UPDATE', async () => {
        await repository.lockComment('c1', trx);
        expect(commentModel.findOne).toHaveBeenCalledWith({
            attributes: ['uuid'],
            where: { uuid: 'c1' },
            lock: 'UPDATE',
            transaction: trx,
        });
    });

    it('findOne по (commentUuid, voterId)', async () => {
        await repository.findOne('c1', 'v1', trx);
        expect(voteModel.findOne).toHaveBeenCalledWith({
            attributes: ['uuid', 'value'],
            where: { commentUuid: 'c1', voterId: 'v1' },
            transaction: trx,
        });
    });

    it('create / update / delete', async () => {
        await repository.create('c1', 'v1', 1, trx);
        expect(voteModel.create).toHaveBeenCalledWith({ commentUuid: 'c1', voterId: 'v1', value: 1 }, { transaction: trx });
        await repository.update('id', -1, trx);
        expect(voteModel.update).toHaveBeenCalledWith({ value: -1 }, { where: { uuid: 'id' }, transaction: trx });
        await repository.delete('id', trx);
        expect(voteModel.destroy).toHaveBeenCalledWith({ where: { uuid: 'id' }, transaction: trx });
    });

    it('incrementCounters — атомарный increment', async () => {
        const deltas = { likesCount: 1, dislikesCount: -1, rating: 2 };
        await repository.incrementCounters('c1', deltas, trx);
        expect(commentModel.increment).toHaveBeenCalledWith(deltas, { where: { uuid: 'c1' }, transaction: trx });
    });

    it('findCounters', async () => {
        await repository.findCounters('c1', trx);
        expect(commentModel.findOne).toHaveBeenCalledWith({
            attributes: ['likesCount', 'dislikesCount', 'rating'],
            where: { uuid: 'c1' },
            transaction: trx,
        });
    });

    it('findAllByVoter: пустой список без запроса, иначе IN', async () => {
        expect(await repository.findAllByVoter('v', [])).toEqual([]);
        expect(voteModel.findAll).not.toHaveBeenCalled();
        await repository.findAllByVoter('v', ['a']);
        expect(voteModel.findAll).toHaveBeenCalledWith({
            attributes: ['commentUuid', 'value'],
            where: { voterId: 'v', commentUuid: { [Op.in]: ['a'] } },
        });
    });
});
