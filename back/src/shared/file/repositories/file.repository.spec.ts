import { FileRepository } from './file.repository';

it('FileRepository.create пишет в транзакции', async () => {
    const model = { create: jest.fn().mockResolvedValue('f') };
    expect(await new FileRepository(model as any).create({ path: 'p' } as any, 'trx' as any)).toBe('f');
    expect(model.create).toHaveBeenCalledWith({ path: 'p' }, { transaction: 'trx' });
});
