import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';
import { getMeiliSearchConfig } from 'src/config/meilisearch.config';
import { MeiliSearchService } from './services/meilisearch.service';

@Global()
@Module({
    providers: [
        {
            provide: MeiliSearch,
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => new MeiliSearch(getMeiliSearchConfig(configService)),
        },
        MeiliSearchService,
    ],
    exports: [MeiliSearch, MeiliSearchService],
})
export class MeilisearchModule {}
