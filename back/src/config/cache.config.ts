import { createKeyv } from '@keyv/redis';
import { CacheModuleOptions } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';

export const getCacheConfig = (configService: ConfigService): CacheModuleOptions => {
    const password = configService.get<string>('REDIS_PASSWORD');
    const auth = password ? `:${encodeURIComponent(password)}@` : '';
    const url = `redis://${auth}${configService.get('REDIS_HOST')}:${configService.get('REDIS_PORT')}/${configService.get('REDIS_DB') || 0}`;

    return {
        stores: [createKeyv(url, { namespace: 'cache' })],
    };
};
