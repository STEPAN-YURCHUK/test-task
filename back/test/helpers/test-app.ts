import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import Redis from 'ioredis';
import { Sequelize } from 'sequelize-typescript';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { AwsS3Service } from 'src/infrastructure/aws-s3/services/aws-s3.service';
import { MeiliIndexEnum } from 'src/infrastructure/meilisearch/enums/meili-index.enum';
import { MeiliSearchService } from 'src/infrastructure/meilisearch/services/meilisearch.service';
import { REDIS_CLIENT } from 'src/infrastructure/redis/redis.const';
import { InMemoryS3Service } from './in-memory-s3.service';

export type TestApp = {
    app: NestExpressApplication;
    s3: InMemoryS3Service;
    baseUrl: string;
    reset: () => Promise<void>;
    waitForIndex: () => Promise<void>;
    close: () => Promise<void>;
};

// Полноценное приложение (Postgres, Redis DB 1, Meilisearch test_*, очередь Bull, socket.io) с S3 в памяти
export async function createTestApp(): Promise<TestApp> {
    const s3 = new InMemoryS3Service();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(AwsS3Service)
        .useValue(s3)
        .compile();

    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
    await configureApp(app);
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const sequelize = app.get(Sequelize);
    const redis = app.get<Redis>(REDIS_CLIENT);
    const meili = app.get(MeiliSearchService);

    // Индекс догоняет БД по событиям асинхронно: ждём, пока документов станет столько же, сколько строк
    const waitForIndex = async () => {
        const deadline = Date.now() + 15_000;
        for (;;) {
            await meili.waitForPendingTasks(MeiliIndexEnum.COMMENT);
            const [[{ count }]] = (await sequelize.query('SELECT count(*)::int AS count FROM comments')) as [{ count: number }[], unknown];
            if ((await meili.countDocuments(MeiliIndexEnum.COMMENT)) === count) return;
            if (Date.now() > deadline) throw new Error('Meilisearch index did not catch up with the database');
            await new Promise((r) => setTimeout(r, 50));
        }
    };

    const reset = async () => {
        await sequelize.query('TRUNCATE TABLE comment_votes, files, comments, users RESTART IDENTITY CASCADE');
        await redis.flushdb(); // только DB 1 — см. setup-env.ts
        await meili.clear(MeiliIndexEnum.COMMENT);
        s3.objects.clear();
    };

    return { app, s3, baseUrl, reset, waitForIndex, close: () => app.close() };
}
