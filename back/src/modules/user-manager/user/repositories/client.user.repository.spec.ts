import { ClientUserRepository } from './client.user.repository';

describe('ClientUserRepository.upsert', () => {
    it('ON CONFLICT по колонкам (email, user_name), возвращает запись', async () => {
        const model = { upsert: jest.fn().mockResolvedValue([{ uuid: 'u1' }, true]) };
        const trx: any = {};
        const user = await new ClientUserRepository(model as any).upsert({ userName: 'J', email: 'j@x.io' }, trx);
        expect(user).toEqual({ uuid: 'u1' });
        expect(model.upsert).toHaveBeenCalledWith(
            { userName: 'J', email: 'j@x.io' },
            { conflictFields: ['email', 'user_name'], returning: true, transaction: trx },
        );
    });
});
