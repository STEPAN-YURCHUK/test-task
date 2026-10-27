import { HttpException, Logger } from '@nestjs/common';
import { FileUploadProcessor } from './file-upload.processor';

describe('FileUploadProcessor', () => {
    const uploads = { process: jest.fn(), markFailed: jest.fn() };
    const processor = new FileUploadProcessor(uploads as any);
    const job = (extra = {}) =>
        ({ id: 'up-1', data: { uploadId: 'up-1' }, discard: jest.fn(), attemptsMade: 1, opts: { attempts: 3 }, ...extra }) as any;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    it('успех', async () => {
        await processor.handle(job());
        expect(uploads.process).toHaveBeenCalledWith('up-1');
    });

    it('битый файл (HttpException) → discard и FAILED с причиной, без повтора', async () => {
        const j = job();
        uploads.process.mockRejectedValueOnce(new HttpException('file_image_invalid', 422));
        await expect(processor.handle(j)).resolves.toBeUndefined();
        expect(j.discard).toHaveBeenCalled();
        expect(uploads.markFailed).toHaveBeenCalledWith('up-1', 'file_image_invalid');
    });

    it('сбой инфраструктуры пробрасывается — Bull повторит', async () => {
        const j = job();
        uploads.process.mockRejectedValueOnce(new Error('S3 timeout'));
        await expect(processor.handle(j)).rejects.toThrow('S3 timeout');
        expect(j.discard).not.toHaveBeenCalled();
    });

    it('handleVideo использует тот же обработчик', async () => {
        await processor.handleVideo(job());
        expect(uploads.process).toHaveBeenCalledWith('up-1');
    });

    it('onFailed: не последняя попытка — ничего', async () => {
        await processor.onFailed(job({ attemptsMade: 1 }), new Error('x'));
        expect(uploads.markFailed).not.toHaveBeenCalled();
    });

    it('onFailed: последняя попытка → file_processing_failed', async () => {
        await processor.onFailed(job({ attemptsMade: 3 }), new Error('x'));
        expect(uploads.markFailed).toHaveBeenCalledWith('up-1', 'file_processing_failed');
    });

    it('onFailed: без attempts в опциях — одна попытка', async () => {
        await processor.onFailed(job({ attemptsMade: 1, opts: {} }), new Error('x'));
        expect(uploads.markFailed).toHaveBeenCalled();
    });
});
