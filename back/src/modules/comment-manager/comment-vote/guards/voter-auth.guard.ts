import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { JwtTokenService } from 'src/infrastructure/jwt-token/services/jwt-token.service';

// Без Passport, как в остальном проекте: читаем Bearer-токен голосующего и кладём req.voter
@Injectable()
export class VoterAuthGuard implements CanActivate {
    constructor(private readonly jwtTokenService: JwtTokenService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const [type, token] = String(request.headers.authorization ?? '').split(' ');

        if (type !== 'Bearer' || !token) {
            throw new HttpException('invalid_voter_token', HttpStatus.UNAUTHORIZED);
        }

        request.voter = this.jwtTokenService.verifyVoterToken(token);
        return true;
    }
}
