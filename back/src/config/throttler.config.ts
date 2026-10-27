import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const getThrottlerConfig = (configService: ConfigService): ThrottlerModuleOptions => {
    // нагрузочные/e2e тесты бьют с одного IP; в production выключить лимиты нельзя
    const disabled = configService.get('THROTTLE_DISABLED') === 'true' && configService.get('NODE_ENV') !== 'production';

    return {
        throttlers: [{ ttl: 60_000, limit: +(configService.get('THROTTLE_LIMIT') || 120) }],
        skipIf: () => disabled,
    };
};
