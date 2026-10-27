import { LOGO_DARK_DATA_URI, LOGO_DATA_URI } from './scalar-logo';
import { scalarHandler } from './scalar.config';

describe('scalarHandler', () => {
    it('рендерит переданный OpenAPI-документ с брендингом и выключенными dev-панелями', () => {
        const document = { openapi: '3.0.0', info: { title: 'Comments API', version: '1' }, paths: {} } as any;
        const res = { type: jest.fn().mockReturnThis(), send: jest.fn() };

        scalarHandler(document)({} as any, res as any);

        expect(res.type).toHaveBeenCalledWith('html');
        expect(res.send.mock.calls[0][0]).toContain('<title>Comments API</title>');
        expect(res.send.mock.calls[0][0]).toContain('"openapi":"3.0.0"');
    });

    it('логотипы — SVG data URI с названием API: тёмный текст для светлой темы, светлый — для тёмной', () => {
        const decode = (uri: string) => Buffer.from(uri.split(',')[1], 'base64').toString();
        expect(LOGO_DATA_URI).toMatch(/^data:image\/svg\+xml;base64,/);
        expect(decode(LOGO_DATA_URI)).toContain('Comments API');
        expect(decode(LOGO_DATA_URI)).toContain('fill="#16161f"');
        expect(decode(LOGO_DARK_DATA_URI)).toContain('fill="#f2f2f8"');
    });
});
