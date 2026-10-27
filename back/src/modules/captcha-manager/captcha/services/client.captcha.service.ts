import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import * as svgCaptcha from 'svg-captcha';
import { JwtTokenService } from 'src/infrastructure/jwt-token/services/jwt-token.service';
import { REDIS_CLIENT } from 'src/infrastructure/redis/redis.const';
import { ClientCaptcha } from '../types/client.captcha.type';
import { ClientVerifyCaptchaInput } from '../types/client.verify-captcha-input.type';

const USED_TOKEN_TTL_MS = 10 * 60_000;

// модуль svg-captcha сам является функцией (text, options) → svg, но в его типах это не описано
const renderCaptchaText = svgCaptcha as unknown as (text: string, options: svgCaptcha.ConfigObject) => string;

// Ответ капчи не хранится на сервере: в JWT лежит HMAC(jti:answer), а использованные jti
// помечаются в Redis атомарным SET NX — токен одноразовый, и при верном, и при неверном ответе,
// в т.ч. при параллельных запросах с одним токеном.
@Injectable()
export class ClientCaptchaService {
    constructor(
        private readonly jwtTokenService: JwtTokenService,
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
    ) {}

    generate(): ClientCaptcha {
        // e2e/нагрузочные тесты: картинка с заранее известным текстом (см. getFixedText)
        const fixedText = this.getFixedText();
        if (fixedText) return this.build(renderCaptchaText(fixedText, { noise: 1, width: 180, height: 56 }), fixedText);

        const { data, text } = svgCaptcha.create({
            size: 6,
            ignoreChars: '0oO1lIi',
            noise: 3,
            color: true,
            background: '#f3efe6',
            width: 180,
            height: 56,
        });
        return this.build(data, text);
    }

    // Только вне production: в production фиксированный текст игнорируется, даже если переменная задана
    private getFixedText(): string | null {
        const text = process.env.CAPTCHA_FIXED_TEXT;
        return text && process.env.NODE_ENV !== 'production' ? text : null;
    }

    private build(data: string, text: string): ClientCaptcha {
        const jti = randomUUID();
        const token = this.jwtTokenService.generateCaptchaToken({ jti, hash: this.hash(jti, text) });

        return {
            token,
            image: `data:image/svg+xml;base64,${Buffer.from(data).toString('base64')}`,
        };
    }

    async verify(data: ClientVerifyCaptchaInput): Promise<void> {
        const { jti, hash } = this.jwtTokenService.verifyCaptchaToken(data.token);
        const usedKey = `captcha:used:${jti}`;

        // get + set не атомарны: параллельные запросы успели бы пройти проверку до записи
        const marked = await this.redis.set(usedKey, '1', 'PX', USED_TOKEN_TTL_MS, 'NX');
        if (marked !== 'OK') {
            throw new HttpException('captcha_expired', HttpStatus.BAD_REQUEST);
        }

        const expected = Buffer.from(hash);
        const actual = Buffer.from(this.hash(jti, data.answer));

        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
            throw new HttpException('captcha_invalid', HttpStatus.BAD_REQUEST);
        }
    }

    private hash(jti: string, answer: string): string {
        return createHmac('sha256', process.env.JWT_CAPTCHA_SECRET).update(`${jti}:${answer.trim().toLowerCase()}`).digest('hex');
    }
}
