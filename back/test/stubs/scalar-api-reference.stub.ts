// Jest работает в CommonJS, а @scalar/nestjs-api-reference тянет ESM-зависимость (client-side-rendering).
// В тестах подменяем пакет этим стабом с тем же контрактом: apiReference(options) → express-обработчик.
// Настоящий рендер Scalar проверяется в браузере (http://localhost:4000/api/docs).
export const apiReference =
    (options: { pageTitle?: string; content?: unknown }) => (_req: unknown, res: { type: (t: string) => { send: (b: string) => void } }) =>
        res
            .type('html')
            .send(
                `<!doctype html><title>${options.pageTitle ?? ''}</title><script id="api-reference" type="application/json">${JSON.stringify(options.content ?? {})}</script>`,
            );

export type ApiReferenceOptions = Record<string, unknown>;
