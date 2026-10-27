import { BullModule } from '@nestjs/bull';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { getCacheConfig } from './config/cache.config';
import { getRedisConfig } from './config/redis.config';
import { getThrottlerConfig } from './config/throttler.config';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AwsS3Module } from './infrastructure/aws-s3/aws-s3.module';
import { JwtTokenModule } from './infrastructure/jwt-token/jwt-token.module';
import { MeilisearchModule } from './infrastructure/meilisearch/meilisearch.module';
import { DisposableEmailModule } from './infrastructure/disposable-email/disposable-email.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { CaptchaManagerModule } from './modules/captcha-manager/captcha-manager.module';
import { CommentManagerModule } from './modules/comment-manager/comment-manager.module';
import { UserManagerModule } from './modules/user-manager/user-manager.module';
import { FileModule } from './shared/file/file.module';
import { LocalizationModule } from './shared/localization/localization.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            envFilePath: `${process.env.NODE_ENV ? '.' + process.env.NODE_ENV + '.env' : '.env'}`,
            isGlobal: true,
        }),
        DatabaseModule,
        CacheModule.registerAsync({
            isGlobal: true,
            inject: [ConfigService],
            useFactory: getCacheConfig,
        }),
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: getRedisConfig,
        }),
        ThrottlerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: getThrottlerConfig,
        }),
        EventEmitterModule.forRoot(),
        LocalizationModule,
        JwtTokenModule,
        AwsS3Module,
        RedisModule,
        DisposableEmailModule,
        FileModule,
        MeilisearchModule,
        UserManagerModule,
        CaptchaManagerModule,
        CommentManagerModule,
    ],
})
export class AppModule {}
