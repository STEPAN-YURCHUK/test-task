import { ClientCommentErrorService } from './client.comment-error.service';

describe('ClientCommentErrorService', () => {
    const repository = { findOneToCheck: jest.fn() };
    const service = new ClientCommentErrorService(repository as any);

    it('checkExists: есть → ok, нет → 404 comment_not_found', async () => {
        repository.findOneToCheck.mockResolvedValueOnce({ uuid: 'c' });
        await expect(service.checkExists('c')).resolves.toBeUndefined();
        repository.findOneToCheck.mockResolvedValueOnce(null);
        await expect(service.checkExists('x')).rejects.toMatchObject({ message: 'comment_not_found', status: 404 });
    });

    it('checkParentExists: нет → 422 parent_comment_not_found, транзакция пробрасывается', async () => {
        const trx: any = {};
        repository.findOneToCheck.mockResolvedValueOnce(null);
        await expect(service.checkParentExists('p', trx)).rejects.toMatchObject({ message: 'parent_comment_not_found', status: 422 });
        expect(repository.findOneToCheck).toHaveBeenLastCalledWith('p', trx);
        repository.findOneToCheck.mockResolvedValueOnce({ uuid: 'p' });
        await expect(service.checkParentExists('p')).resolves.toBeUndefined();
    });
});
