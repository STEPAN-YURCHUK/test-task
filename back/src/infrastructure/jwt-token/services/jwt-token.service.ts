import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CaptchaTokenPayload } from '../types/captcha-token-payload.type';
import { VoterTokenPayload } from '../types/voter-token-payload.type';

@Injectable()
export class JwtTokenService {
    constructor(private readonly jwtService: JwtService) {}

    generateCaptchaToken(payload: CaptchaTokenPayload): string {
        return this.jwtService.sign(
            { ...payload, purpose: 'captcha' },
            {
                secret: process.env.JWT_CAPTCHA_SECRET,
                expiresIn: (process.env.JWT_CAPTCHA_TIME || '5m') as any,
            },
        );
    }

    verifyCaptchaToken(token: string): CaptchaTokenPayload {
        try {
            const payload = this.jwtService.verify(token, { secret: process.env.JWT_CAPTCHA_SECRET });
            if (payload?.purpose !== 'captcha' || !payload.jti || !payload.hash) throw new Error();
            return { jti: payload.jti, hash: payload.hash };
        } catch {
            throw new HttpException('captcha_expired', HttpStatus.BAD_REQUEST);
        }
    }

    // Анонимный голосующий: регистрации нет, браузер получает долгоживущий токен со случайным voterId
    generateVoterToken(payload: VoterTokenPayload): string {
        return this.jwtService.sign(
            { ...payload, purpose: 'voter' },
            {
                secret: process.env.JWT_VOTER_SECRET,
                expiresIn: (process.env.JWT_VOTER_TIME || '365d') as any,
            },
        );
    }

    verifyVoterToken(token: string): VoterTokenPayload {
        try {
            const payload = this.jwtService.verify(token, { secret: process.env.JWT_VOTER_SECRET });
            if (payload?.purpose !== 'voter' || !payload.voterId) throw new Error();
            return { voterId: payload.voterId };
        } catch {
            throw new HttpException('invalid_voter_token', HttpStatus.UNAUTHORIZED);
        }
    }
}
