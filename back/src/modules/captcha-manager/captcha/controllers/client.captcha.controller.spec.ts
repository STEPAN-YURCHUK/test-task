import { ClientCaptchaController } from './client.captcha.controller';

describe('ClientCaptchaController', () => {
    it('generate делегирует сервису', () => {
        const service: any = { generate: jest.fn().mockReturnValue({ token: 't', image: 'i' }) };
        expect(new ClientCaptchaController(service).generate()).toEqual({ token: 't', image: 'i' });
    });
});
