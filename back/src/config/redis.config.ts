import { BullModuleOptions } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';

export const getRedisConfig = (configService: ConfigService): BullModuleOptions => {
    return {
        redis: {
            host: configService.get('REDIS_HOST'),
            port: +configService.get('REDIS_PORT'),
            password: configService.get('REDIS_PASSWORD') || undefined,
            // отдельная БД для тестов: иначе воркеры dev-сервера заберут задачи из тестовой очереди
            db: +(configService.get('REDIS_DB') || 0),
        },
    };
};
