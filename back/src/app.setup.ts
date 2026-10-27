import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { scalarHandler } from './config/scalar.config';
import { Request, Response } from 'express';
import { MeiliSearch } from 'meilisearch';
import { I18nService } from 'nestjs-i18n';
import { swaggerConfig } from './config/swagger.config';
import { initMeili } from './infrastructure/meilisearch/meilisearch.init';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { applySwaggerTagGroups } from './shared/swagger/swagger-tag-groups.helper';

// Общая настройка приложения: main.ts и e2e-тесты собирают его одинаково
export async function configureApp(app: NestExpressApplication): Promise<void> {
    const configService = app.get(ConfigService);

    // за reverse proxy (nginx / docker) берём реальный IP клиента из X-Forwarded-For
    app.set('trust proxy', 'loopback, linklocal, uniquelocal');
    app.setGlobalPrefix('api/v1');
    app.enableShutdownHooks();
    app.enableCors({
        origin: (configService.get<string>('CORS_ORIGINS') || 'http://localhost:3000').split(','),
        credentials: true,
    });

    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            whitelist: true,
            exceptionFactory: (errors) => {
                throw new BadRequestException({ message: 'not_valid_data', errors });
            },
        }),
    );

    // настройки индексов до старта: иначе первые запросы списка упадут на sort/filter
    await initMeili(app.get(MeiliSearch));

    app.useGlobalFilters(new GlobalExceptionFilter(app.get(I18nService)));

    if (configService.get<string>('API_DOCS_ENABLED') === 'true') {
        // @nestjs/swagger собирает OpenAPI из декораторов, рендерит его Scalar
        const document = SwaggerModule.createDocument(app, swaggerConfig);
        applySwaggerTagGroups(app, document);
        app.use('/api/docs', scalarHandler(document));
        app.getHttpAdapter().get('/api/docs-json', (_req: Request, res: Response) => res.json(document));
    }
}
