import { JwtService } from '@nestjs/jwt';
import * as svgCaptcha from 'svg-captcha';
import { JwtTokenService } from 'src/infrastructure/jwt-token/services/jwt-token.service';
import { ClientCaptchaService } from './client.captcha.service';

// in-memory замена Redis: SET key value PX ttl NX
const createRedis = () => {
    const store = new Map<string, unknown>();
    return {
        store,
        set: jest.fn(async (key: string, value: unknown) => {
            if (store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        }),
    };
};

const errorOf = async (promise: Promise<unknown>) => {
    try {
        await promise;
    } catch (e: any) {
        return { key: e.message, status: e.getStatus?.() };
    }
    return null;
};

describe('ClientCaptchaService', () => {
    const env = { ...process.env };
    const jwtTokenService = new JwtTokenService(new JwtService());
    let redis: ReturnType<typeof createRedis>;
    let service: ClientCaptchaService;

    beforeEach(() => {
        process.env.JWT_CAPTCHA_SECRET = 'secret';
        delete process.env.CAPTCHA_FIXED_TEXT;
        process.env.NODE_ENV = 'test';
        redis = createRedis();
        service = new ClientCaptchaService(jwtTokenService, redis as any);
    });

    afterEach(() => jest.restoreAllMocks());
    afterAll(() => {
        process.env = env;
    });

    // перехватываем svgCaptcha.create, чтобы знать ответ
    const generateKnown = (text: string) => {
        jest.spyOn(svgCaptcha, 'create').mockReturnValue({ data: '<svg/>', text });
        return service.generate();
    };

    it('generate: svg в data URI и подписанный токен', () => {
        const captcha = service.generate();
        expect(captcha.image.startsWith('data:image/svg+xml;base64,')).toBe(true);
        expect(Buffer.from(captcha.image.split(',')[1], 'base64').toString()).toContain('<svg');
        expect(jwtTokenService.verifyCaptchaToken(captcha.token).jti).toBeTruthy();
    });

    it('каждый generate даёт новый jti', () => {
        const a = jwtTokenService.verifyCaptchaToken(service.generate().token);
        const b = jwtTokenService.verifyCaptchaToken(service.generate().token);
        expect(a.jti).not.toBe(b.jti);
    });

    it('верный ответ проходит, регистр и пробелы не важны', async () => {
        const { token } = generateKnown('AbC123');
        await expect(service.verify({ token, answer: '  abc123 ' })).resolves.toBeUndefined();
        expect(redis.set).toHaveBeenCalledWith(expect.stringMatching(/^captcha:used:/), '1', 'PX', 600000, 'NX');
    });

    it('неверный ответ → captcha_invalid, токен сгорает', async () => {
        const { token } = generateKnown('AbC123');
        expect(await errorOf(service.verify({ token, answer: 'zzz' }))).toEqual({ key: 'captcha_invalid', status: 400 });
        expect(await errorOf(service.verify({ token, answer: 'abc123' }))).toEqual({ key: 'captcha_expired', status: 400 });
    });

    it('повторное использование верного токена → captcha_expired', async () => {
        const { token } = generateKnown('xyz789');
        await service.verify({ token, answer: 'xyz789' });
        expect(await errorOf(service.verify({ token, answer: 'xyz789' }))).toEqual({ key: 'captcha_expired', status: 400 });
    });

    it('параллельные запросы с одним токеном: проходит ровно один', async () => {
        const { token } = generateKnown('race01');
        const results = await Promise.all(Array.from({ length: 5 }, () => errorOf(service.verify({ token, answer: 'race01' }))));
        expect(results.filter((r) => r === null)).toHaveLength(1);
        expect(results.filter((r) => r?.key === 'captcha_expired')).toHaveLength(4);
    });

    it('просроченный / чужой токен → captcha_expired', async () => {
        const foreign = new JwtService().sign({ jti: 'j', hash: 'h', purpose: 'captcha' }, { secret: 'other' });
        expect((await errorOf(service.verify({ token: foreign, answer: 'a' })))?.key).toBe('captcha_expired');
    });

    it('хеш другой длины в токене → captcha_invalid (без timingSafeEqual)', async () => {
        const token = jwtTokenService.generateCaptchaToken({ jti: 'j-short', hash: 'short' });
        expect((await errorOf(service.verify({ token, answer: 'abc' })))?.key).toBe('captcha_invalid');
    });

    it('CAPTCHA_FIXED_TEXT вне production — известный ответ', async () => {
        process.env.CAPTCHA_FIXED_TEXT = 'e2e123';
        const create = jest.spyOn(svgCaptcha, 'create');
        const { token, image } = service.generate();
        expect(create).not.toHaveBeenCalled();
        expect(image.startsWith('data:image/svg+xml;base64,')).toBe(true);
        await expect(service.verify({ token, answer: 'E2E123' })).resolves.toBeUndefined();
    });

    it('CAPTCHA_FIXED_TEXT в production игнорируется', async () => {
        process.env.CAPTCHA_FIXED_TEXT = 'e2e123';
        process.env.NODE_ENV = 'production';
        const { token } = service.generate();
        expect((await errorOf(service.verify({ token, answer: 'e2e123' })))?.key).toBe('captcha_invalid');
    });
});
