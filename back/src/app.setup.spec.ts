import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { MeiliSearch } from 'meilisearch';
import { I18nService } from 'nestjs-i18n';
import { configureApp } from './app.setup';
import { initMeili } from './infrastructure/meilisearch/meilisearch.init';
import { scalarHandler } from './config/scalar.config';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { applySwaggerTagGroups } from './shared/swagger/swagger-tag-groups.helper';

jest.mock('./infrastructure/meilisearch/meilisearch.init', () => ({ initMeili: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./shared/swagger/swagger-tag-groups.helper', () => ({ applySwaggerTagGroups: jest.fn() }));
jest.mock('./config/scalar.config', () => ({ scalarHandler: jest.fn(() => 'scalar-handler') }));

const createApp = (env: Record<string, string>) => {
    const meili = {};
    const routes: Record<string, (req: any, res: any) => void> = {};
    const app: any = {
        get: jest.fn((token) => {
            if (token === ConfigService) return { get: (key: string) => env[key] };
            if (token === MeiliSearch) return meili;
            if (token === I18nService) return { translate: (k: string) => k };
        }),
        set: jest.fn(),
        setGlobalPrefix: jest.fn(),
        enableShutdownHooks: jest.fn(),
        enableCors: jest.fn(),
        useGlobalPipes: jest.fn(),
        useGlobalFilters: jest.fn(),
        use: jest.fn(),
        getHttpAdapter: () => ({ get: (path: string, handler: any) => (routes[path] = handler) }),
    };
    return { app, meili, routes };
};

describe('configureApp', () => {
    let createDocument: jest.SpyInstance;
    let setup: jest.SpyInstance;

    beforeEach(() => {
        createDocument = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({ openapi: '3.0.0' } as any);
        setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('префикс, trust proxy, CORS из env, пайп, фильтр, Meilisearch до старта', async () => {
        const { app, meili } = createApp({ CORS_ORIGINS: 'http://a,http://b' });
        await configureApp(app);

        expect(app.set).toHaveBeenCalledWith('trust proxy', 'loopback, linklocal, uniquelocal');
        expect(app.setGlobalPrefix).toHaveBeenCalledWith('api/v1');
        expect(app.enableShutdownHooks).toHaveBeenCalled();
        expect(app.enableCors).toHaveBeenCalledWith({ origin: ['http://a', 'http://b'], credentials: true });
        expect(app.useGlobalPipes.mock.calls[0][0]).toBeInstanceOf(ValidationPipe);
        expect(app.useGlobalFilters.mock.calls[0][0]).toBeInstanceOf(GlobalExceptionFilter);
        expect(initMeili).toHaveBeenCalledWith(meili);
        expect(createDocument).not.toHaveBeenCalled();
    });

    it('CORS по умолчанию — localhost:3000', async () => {
        const { app } = createApp({});
        await configureApp(app);
        expect(app.enableCors).toHaveBeenCalledWith({ origin: ['http://localhost:3000'], credentials: true });
    });

    it('ValidationPipe отдаёт not_valid_data с ошибками', async () => {
        const { app } = createApp({});
        await configureApp(app);
        const pipe: any = app.useGlobalPipes.mock.calls[0][0];
        const factory = pipe.exceptionFactory;
        try {
            factory([{ property: 'email' }]);
        } catch (e) {
            expect(e).toBeInstanceOf(BadRequestException);
            expect((e as BadRequestException).getResponse()).toEqual({ message: 'not_valid_data', errors: [{ property: 'email' }] });
        }
        expect.assertions(2);
    });

    it('API_DOCS_ENABLED=true — Scalar на /api/docs с группами тегов и /api/docs-json', async () => {
        const { app, routes } = createApp({ API_DOCS_ENABLED: 'true' });
        await configureApp(app);
        expect(applySwaggerTagGroups).toHaveBeenCalledWith(app, { openapi: '3.0.0' });
        expect(scalarHandler).toHaveBeenCalledWith({ openapi: '3.0.0' });
        expect(app.use).toHaveBeenCalledWith('/api/docs', 'scalar-handler');
        expect(setup).not.toHaveBeenCalled();
        const res = { json: jest.fn() };
        routes['/api/docs-json']({}, res);
        expect(res.json).toHaveBeenCalledWith({ openapi: '3.0.0' });
    });
});
