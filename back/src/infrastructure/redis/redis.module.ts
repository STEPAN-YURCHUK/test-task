import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.const';

// Прямой клиент Redis для атомарных операций (SET NX, TTL), которых нет в cache-manager
@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) =>
                new Redis({
                    host: configService.get('REDIS_HOST'),
                    port: +configService.get('REDIS_PORT'),
                    password: configService.get('REDIS_PASSWORD') || undefined,
                    db: +(configService.get('REDIS_DB') || 0),
                    keyPrefix: 'comments:',
                }),
        },
    ],
    exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    async onApplicationShutdown() {
        await this.redis.quit();
    }
}
