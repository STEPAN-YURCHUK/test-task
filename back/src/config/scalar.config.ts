import { OpenAPIObject } from '@nestjs/swagger';
import { apiReference, ApiReferenceOptions } from '@scalar/nestjs-api-reference';
import { LOGO_DARK_DATA_URI, LOGO_DATA_URI } from './scalar-logo';

// Слота под логотип у Scalar нет: вешаем его через ::before на сайдбар
const brandCss = `
.t-doc__sidebar::before {
    content: '';
    display: block;
    flex: none;
    height: 40px;
    margin: 20px 12px 12px;
    background: url('${LOGO_DATA_URI}') left center / contain no-repeat;
}

.dark-mode .t-doc__sidebar::before {
    background-image: url('${LOGO_DARK_DATA_URI}');
}

/* имена событий и полей в таблицах описания не переносить посреди слова */
table td:first-child code {
    white-space: nowrap;
}
`;

/**
 * Scalar рендерит OpenAPI-документ, собранный @nestjs/swagger из декораторов контроллеров и DTO.
 */
export const scalarHandler = (document: OpenAPIObject) =>
    apiReference({
        content: document,
        pageTitle: 'Comments API',
        theme: 'purple',
        // тёмная тема по умолчанию; переключатель светлой остаётся в сайдбаре
        darkMode: true,
        customCss: brandCss,
        authentication: { preferredSecurityScheme: 'voter' },
        // токен голосующего вводится один раз и переживает перезагрузку страницы
        persistAuth: true,
        // Ask AI, MCP и developer tools Scalar сам включает на localhost — гасим, чтобы dev и прод выглядели одинаково
        agent: { disabled: true },
        mcp: { disabled: true },
        showDeveloperTools: 'never',
        // ключей agent/mcp нет в типах @scalar/types — рендерер тянется с CDN и знает их
    } as ApiReferenceOptions);
