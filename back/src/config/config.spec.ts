import { ConfigService } from '@nestjs/config';
import { getAwsS3ClientConfig } from './aws-s3.config';
import { getCacheConfig } from './cache.config';
import { getMeiliSearchConfig } from './meilisearch.config';
import { getPostgresConfig } from './postgres.config';
import { getRedisConfig } from './redis.config';
import { swaggerConfig } from './swagger.config';
import { getThrottlerConfig } from './throttler.config';

const config = (values: Record<string, any>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('config factories', () => {
    describe('getRedisConfig (Bull)', () => {
        it('берёт host/port/password и REDIS_DB', () => {
            const result: any = getRedisConfig(config({ REDIS_HOST: 'h', REDIS_PORT: '6381', REDIS_PASSWORD: 'p', REDIS_DB: '1' }));
            expect(result.redis).toEqual({ host: 'h', port: 6381, password: 'p', db: 1 });
        });

        it('пустой пароль → undefined, без REDIS_DB → 0', () => {
            const result: any = getRedisConfig(config({ REDIS_HOST: 'h', REDIS_PORT: '1', REDIS_PASSWORD: '' }));
            expect(result.redis.password).toBeUndefined();
            expect(result.redis.db).toBe(0);
        });
    });

    describe('getCacheConfig', () => {
        it('создаёт keyv-хранилище', () => {
            const result: any = getCacheConfig(config({ REDIS_HOST: 'localhost', REDIS_PORT: '6381', REDIS_DB: '2' }));
            expect(result.stores).toHaveLength(1);
        });

        it('с паролем тоже создаёт хранилище', () => {
            const result: any = getCacheConfig(config({ REDIS_HOST: 'localhost', REDIS_PORT: '6381', REDIS_PASSWORD: 'p@ss' }));
            expect(result.stores).toHaveLength(1);
        });
    });

    describe('getThrottlerConfig', () => {
        it('лимит по умолчанию 120 и не пропускает', () => {
            const result: any = getThrottlerConfig(config({}));
            expect(result.throttlers).toEqual([{ ttl: 60_000, limit: 120 }]);
            expect(result.skipIf()).toBe(false);
        });

        it('THROTTLE_LIMIT переопределяет лимит', () => {
            const result: any = getThrottlerConfig(config({ THROTTLE_LIMIT: '5' }));
            expect(result.throttlers[0].limit).toBe(5);
        });

        it('THROTTLE_DISABLED вне production отключает', () => {
            expect((getThrottlerConfig(config({ THROTTLE_DISABLED: 'true', NODE_ENV: 'test' })) as any).skipIf()).toBe(true);
        });

        it('THROTTLE_DISABLED в production игнорируется', () => {
            expect((getThrottlerConfig(config({ THROTTLE_DISABLED: 'true', NODE_ENV: 'production' })) as any).skipIf()).toBe(false);
        });
    });

    describe('getAwsS3ClientConfig', () => {
        it('с endpoint', () => {
            const result = getAwsS3ClientConfig(
                config({ S3_REGION: 'ams3', S3_ENDPOINT: 'https://e', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' }),
            );
            expect(result).toMatchObject({
                region: 'ams3',
                endpoint: 'https://e',
                credentials: { accessKeyId: 'a', secretAccessKey: 's' },
            });
            expect(result.requestChecksumCalculation).toBe('WHEN_REQUIRED');
        });

        it('без endpoint поле не задаётся', () => {
            expect(getAwsS3ClientConfig(config({ S3_REGION: 'r' }))).not.toHaveProperty('endpoint');
        });
    });

    it('getMeiliSearchConfig', () => {
        expect(getMeiliSearchConfig(config({ MEILI_HOST: 'http://m', MEILI_MASTER_KEY: 'k' }))).toEqual({ host: 'http://m', apiKey: 'k' });
    });

    describe('getPostgresConfig', () => {
        it('synchronize по умолчанию включён, UTC, underscored', () => {
            const result: any = getPostgresConfig(config({ POSTGRES_HOST: 'h', POSTGRES_PORT: 5432, POSTGRES_DB: 'd' }));
            expect(result).toMatchObject({
                dialect: 'postgres',
                synchronize: true,
                define: { underscored: true },
                host: 'h',
                database: 'd',
                timezone: '+00:00',
            });
        });

        it('DB_SYNCHRONIZE=false выключает', () => {
            expect((getPostgresConfig(config({ DB_SYNCHRONIZE: 'false' })) as any).synchronize).toBe(false);
        });

        it('afterConnect выставляет UTC', async () => {
            const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
            const query = jest.fn().mockResolvedValue(undefined);
            await (getPostgresConfig(config({})) as any).hooks.afterConnect({ query });
            expect(query).toHaveBeenCalledWith("SET timezone = 'UTC';");
            log.mockRestore();
        });
    });

    it('swaggerConfig', () => {
        expect(swaggerConfig.info.title).toBe('Comments API');
    });
});
