import { ClientCommentErrorRepository } from './client.comment-error.repository';

it('ClientCommentErrorRepository.findOneToCheck выбирает только uuid', async () => {
    const model = { findOne: jest.fn().mockResolvedValue(null) };
    await new ClientCommentErrorRepository(model as any).findOneToCheck('c', 'trx' as any);
    expect(model.findOne).toHaveBeenCalledWith({ attributes: ['uuid'], where: { uuid: 'c' }, transaction: 'trx' });
});
