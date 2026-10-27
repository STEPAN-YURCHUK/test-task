import { JwtService } from '@nestjs/jwt';
import { JwtTokenService } from 'src/infrastructure/jwt-token/services/jwt-token.service';
import { VoterAuthGuard } from './voter-auth.guard';

describe('VoterAuthGuard', () => {
    process.env.JWT_VOTER_SECRET = 'voter-secret';
    const jwt = new JwtTokenService(new JwtService());
    const guard = new VoterAuthGuard(jwt);
    const context = (authorization?: string) => {
        const request: any = { headers: authorization === undefined ? {} : { authorization } };
        return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as any };
    };

    it.each([
        ['нет заголовка', undefined],
        ['не Bearer', 'Basic abc'],
        ['Bearer без токена', 'Bearer '],
        ['чужой токен', 'Bearer garbage'],
    ])('%s → 401', (_, header) => {
        const { ctx } = context(header);
        expect(() => guard.canActivate(ctx)).toThrow('invalid_voter_token');
    });

    it('валидный токен → req.voter', () => {
        const { ctx, request } = context(`Bearer ${jwt.generateVoterToken({ voterId: 'v42' })}`);
        expect(guard.canActivate(ctx)).toBe(true);
        expect(request.voter).toEqual({ voterId: 'v42' });
    });
});
