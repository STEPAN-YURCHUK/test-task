import { JwtService } from '@nestjs/jwt';
import { JwtTokenService } from './jwt-token.service';

describe('JwtTokenService', () => {
    const env = { ...process.env };
    const jwtService = new JwtService();
    const service = new JwtTokenService(jwtService);

    beforeEach(() => {
        process.env.JWT_CAPTCHA_SECRET = 'captcha-secret';
        process.env.JWT_VOTER_SECRET = 'voter-secret';
        delete process.env.JWT_CAPTCHA_TIME;
        delete process.env.JWT_VOTER_TIME;
    });

    afterAll(() => {
        process.env = env;
    });

    const expectHttp = (fn: () => unknown, key: string, status: number) => {
        try {
            fn();
            throw new Error('not thrown');
        } catch (e: any) {
            expect(e.message).toBe(key);
            expect(e.getStatus()).toBe(status);
        }
    };

    describe('captcha token', () => {
        it('roundtrip', () => {
            const token = service.generateCaptchaToken({ jti: 'j', hash: 'h' });
            expect(service.verifyCaptchaToken(token)).toEqual({ jti: 'j', hash: 'h' });
        });

        it('по умолчанию живёт 5 минут, JWT_CAPTCHA_TIME переопределяет', () => {
            let payload: any = jwtService.decode(service.generateCaptchaToken({ jti: 'j', hash: 'h' }));
            expect(payload.exp - payload.iat).toBe(300);
            process.env.JWT_CAPTCHA_TIME = '1m';
            payload = jwtService.decode(service.generateCaptchaToken({ jti: 'j', hash: 'h' }));
            expect(payload.exp - payload.iat).toBe(60);
        });

        it.each([
            ['чужой секрет', () => jwtService.sign({ jti: 'j', hash: 'h', purpose: 'captcha' }, { secret: 'other' })],
            ['другой purpose', () => jwtService.sign({ jti: 'j', hash: 'h', purpose: 'voter' }, { secret: 'captcha-secret' })],
            ['без hash', () => jwtService.sign({ jti: 'j', purpose: 'captcha' }, { secret: 'captcha-secret' })],
            ['просрочен', () => jwtService.sign({ jti: 'j', hash: 'h', purpose: 'captcha' }, { secret: 'captcha-secret', expiresIn: -10 })],
            ['мусор', () => 'not-a-jwt'],
        ])('%s → 400 captcha_expired', (_, make) => {
            expectHttp(() => service.verifyCaptchaToken(make()), 'captcha_expired', 400);
        });
    });

    describe('voter token', () => {
        it('roundtrip и 365 дней по умолчанию', () => {
            const token = service.generateVoterToken({ voterId: 'v1' });
            expect(service.verifyVoterToken(token)).toEqual({ voterId: 'v1' });
            const payload: any = jwtService.decode(token);
            expect(payload.exp - payload.iat).toBe(365 * 24 * 3600);
        });

        it('JWT_VOTER_TIME переопределяет', () => {
            process.env.JWT_VOTER_TIME = '1h';
            const payload: any = jwtService.decode(service.generateVoterToken({ voterId: 'v1' }));
            expect(payload.exp - payload.iat).toBe(3600);
        });

        it('captcha-токен не принимается как voter', () => {
            expectHttp(() => service.verifyVoterToken(service.generateCaptchaToken({ jti: 'j', hash: 'h' })), 'invalid_voter_token', 401);
        });

        it.each([
            ['без voterId', () => jwtService.sign({ purpose: 'voter' }, { secret: 'voter-secret' })],
            ['чужой секрет', () => jwtService.sign({ voterId: 'v', purpose: 'voter' }, { secret: 'x' })],
            ['просрочен', () => jwtService.sign({ voterId: 'v', purpose: 'voter' }, { secret: 'voter-secret', expiresIn: -1 })],
        ])('%s → 401', (_, make) => {
            expectHttp(() => service.verifyVoterToken(make()), 'invalid_voter_token', 401);
        });
    });
});
