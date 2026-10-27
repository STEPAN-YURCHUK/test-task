import { ClientFileUploadController } from './client.file-upload.controller';

describe('ClientFileUploadController', () => {
    const service = { init: jest.fn(), parts: jest.fn(), complete: jest.fn(), status: jest.fn(), abort: jest.fn() };
    const controller = new ClientFileUploadController(service as any);

    it('init передаёт только filename и size', async () => {
        await controller.init({ filename: 'a.png', size: 5, extra: 1 } as any);
        expect(service.init).toHaveBeenCalledWith({ filename: 'a.png', size: 5 });
    });

    it.each(['parts', 'complete', 'status', 'abort'] as const)('%s делегирует сервису', async (method) => {
        await (controller as any)[method]('up-1');
        expect(service[method]).toHaveBeenCalledWith('up-1');
    });
});
