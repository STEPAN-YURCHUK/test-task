import { ConfigService } from '@nestjs/config';
import { Config } from 'meilisearch';

export const getMeiliSearchConfig = (configService: ConfigService): Config => {
    return {
        host: configService.get<string>('MEILI_HOST'),
        apiKey: configService.get<string>('MEILI_MASTER_KEY'),
    };
};
