import { FileUploadSessionRepository } from './file-upload-session.repository';

describe('FileUploadSessionRepository', () => {
    const redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };
    const repository = new FileUploadSessionRepository(redis as any);

    beforeEach(() => jest.clearAllMocks());

    it('save — JSON с TTL 24 часа', async () => {
        await repository.save({ id: 'u1', status: 'UPLOADING' } as any);
        expect(redis.set).toHaveBeenCalledWith('upload:u1', JSON.stringify({ id: 'u1', status: 'UPLOADING' }), 'EX', 86400);
    });

    it('find: есть / нет', async () => {
        redis.get.mockResolvedValueOnce('{"id":"u1"}').mockResolvedValueOnce(null);
        expect(await repository.find('u1')).toEqual({ id: 'u1' });
        expect(await repository.find('u2')).toBeNull();
    });

    it('remove удаляет сессию и блокировку', async () => {
        await repository.remove('u1');
        expect(redis.del).toHaveBeenCalledWith('upload:u1', 'upload:u1:claim');
    });

    it('acquireClaim — SET NX PX 30s', async () => {
        redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
        expect(await repository.acquireClaim('u1')).toBe(true);
        expect(redis.set).toHaveBeenCalledWith('upload:u1:claim', '1', 'PX', 30000, 'NX');
        expect(await repository.acquireClaim('u1')).toBe(false);
    });

    it('releaseClaim', async () => {
        await repository.releaseClaim('u1');
        expect(redis.del).toHaveBeenCalledWith('upload:u1:claim');
    });
});
