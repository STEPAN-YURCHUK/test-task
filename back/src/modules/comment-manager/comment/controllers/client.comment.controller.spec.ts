import { ClientCommentController } from './client.comment.controller';

describe('ClientCommentController', () => {
    const service = { findAll: jest.fn(), preview: jest.fn(), findOne: jest.fn(), create: jest.fn() };
    const controller = new ClientCommentController(service as any);

    beforeEach(() => jest.clearAllMocks());

    it('findAll: дефолты page=1, createdAt DESC', async () => {
        await controller.findAll({});
        expect(service.findAll).toHaveBeenCalledWith({ page: 1, sortBy: 'createdAt', sortOrder: 'DESC' });
    });

    it('findAll: значения из dto', async () => {
        await controller.findAll({ page: 3, sortBy: 'rating', sortOrder: 'ASC' } as any);
        expect(service.findAll).toHaveBeenCalledWith({ page: 3, sortBy: 'rating', sortOrder: 'ASC' });
    });

    it('preview и findOne делегируют', async () => {
        service.preview.mockReturnValue({ html: 'x' });
        expect(controller.preview({ text: 'x' })).toEqual({ html: 'x' });
        await controller.findOne('c1');
        expect(service.findOne).toHaveBeenCalledWith('c1');
    });

    it('create: dto + файл + ip/user-agent из запроса', async () => {
        const dto: any = {
            userName: 'u',
            email: 'e@x.io',
            homePage: 'https://h',
            text: 't',
            parentUuid: 'p',
            captchaToken: 'ct',
            captcha: 'c',
            uploadId: 'up',
            extraField: 'ignored',
        };
        const file: any = { originalname: 'a.txt' };
        const req: any = { ip: '9.9.9.9', get: (h: string) => (h === 'user-agent' ? 'UA' : undefined) };
        await controller.create(dto, file, req);
        expect(service.create).toHaveBeenCalledWith({
            userName: 'u',
            email: 'e@x.io',
            homePage: 'https://h',
            text: 't',
            parentUuid: 'p',
            captchaToken: 'ct',
            captcha: 'c',
            file,
            uploadId: 'up',
            ipAddress: '9.9.9.9',
            userAgent: 'UA',
        });
    });
});
