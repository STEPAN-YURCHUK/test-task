import { lastValueFrom, of } from 'rxjs';
import { TransformResponseClientCommentInterceptor } from './client.comment.interceptor';

const fileService: any = { getPublicUrl: (path: string) => `https://cdn/${path}` };
const interceptor = new TransformResponseClientCommentInterceptor(fileService);

const user = { userName: 'John', email: 'j@x.io', homePage: null, uuid: 'secret-user-uuid' };
const comment = (extra: Record<string, any> = {}) => ({
    uuid: 'c1',
    parentUuid: null,
    rootUuid: null,
    text: 'hi',
    likesCount: 2,
    dislikesCount: 1,
    rating: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ipAddress: '1.1.1.1',
    userAgent: 'UA',
    userUuid: 'u',
    user,
    file: null,
    ...extra,
});

const imageFile = {
    uuid: 'f1',
    type: 'IMAGE',
    path: 'files/images/original/f1.png',
    originalName: 'a.png',
    mimeType: 'image/png',
    size: 100,
    width: 320,
    height: 160,
    smallPath: 'files/images/small/f1.png',
    mediumPath: 'files/images/medium/f1.png',
    webpSmallPath: 'files/images/webp-small/f1.webp',
    webpMediumPath: 'files/images/webp-medium/f1.webp',
    webpOriginalPath: 'files/images/webp-original/f1.webp',
    smallWidth: 160,
    smallHeight: 80,
    mediumWidth: 240,
    mediumHeight: 120,
    modelUuid: 'c1',
    modelType: 'comments',
    modelColumn: 'file',
};

describe('TransformResponseClientCommentInterceptor', () => {
    it('скрывает ip, userAgent, userUuid, user.uuid, rating', () => {
        const result = interceptor.transform(comment());
        expect(result).toEqual({
            uuid: 'c1',
            parentUuid: null,
            rootUuid: null,
            text: 'hi',
            likesCount: 2,
            dislikesCount: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            user: { userName: 'John', email: 'j@x.io', homePage: null },
            file: null,
        });
    });

    it('счётчики по умолчанию 0, без user → null', () => {
        const result = interceptor.transform({ uuid: 'c', text: 't', user: null });
        expect(result).toMatchObject({ likesCount: 0, dislikesCount: 0, user: null, file: null });
    });

    it('null/undefined проходят как есть', () => {
        expect(interceptor.transform(null)).toBeNull();
    });

    it('картинка: CDN url, варианты small/medium/original, без model*', () => {
        const { file } = interceptor.transform(comment({ file: imageFile }));
        expect(file).toEqual({
            uuid: 'f1',
            type: 'IMAGE',
            url: 'https://cdn/files/images/original/f1.png',
            originalName: 'a.png',
            mimeType: 'image/png',
            size: 100,
            width: 320,
            height: 160,
            variants: {
                small: {
                    url: 'https://cdn/files/images/small/f1.png',
                    webpUrl: 'https://cdn/files/images/webp-small/f1.webp',
                    width: 160,
                    height: 80,
                },
                medium: {
                    url: 'https://cdn/files/images/medium/f1.png',
                    webpUrl: 'https://cdn/files/images/webp-medium/f1.webp',
                    width: 240,
                    height: 120,
                },
                original: {
                    url: 'https://cdn/files/images/original/f1.png',
                    webpUrl: 'https://cdn/files/images/webp-original/f1.webp',
                    width: 320,
                    height: 160,
                },
            },
            video: null,
        });
    });

    it('вариант без webp → webpUrl null', () => {
        const { file } = interceptor.transform(comment({ file: { ...imageFile, webpSmallPath: null } }));
        expect(file.variants.small.webpUrl).toBeNull();
    });

    it('текст: без variants и video, width/height null', () => {
        const { file } = interceptor.transform(
            comment({
                file: { uuid: 'f', type: 'TEXT', path: 'files/texts/f.txt', originalName: 'a.txt', mimeType: 'text/plain', size: 5 },
            }),
        );
        expect(file).toMatchObject({
            type: 'TEXT',
            url: 'https://cdn/files/texts/f.txt',
            width: null,
            height: null,
            variants: null,
            video: null,
        });
    });

    it('видео: duration числом (DECIMAL приходит строкой), постеры', () => {
        const { file } = interceptor.transform(
            comment({
                file: {
                    uuid: 'v',
                    type: 'VIDEO',
                    path: 'files/videos/v.mp4',
                    originalName: 'v.mkv',
                    mimeType: 'video/mp4',
                    size: 9,
                    width: 1280,
                    height: 720,
                    duration: '4.01',
                    posterPath: 'p.jpg',
                    webpPosterPath: 'p.webp',
                },
            }),
        );
        expect(file.video).toEqual({ duration: 4.01, posterUrl: 'https://cdn/p.jpg', webpPosterUrl: 'https://cdn/p.webp' });
        expect(file.variants).toBeNull();
    });

    it('видео без duration и webp-постера', () => {
        const { file } = interceptor.transform(
            comment({ file: { type: 'VIDEO', path: 'v.mp4', posterPath: 'p.jpg', duration: null, webpPosterPath: null } }),
        );
        expect(file.video).toEqual({ duration: null, posterUrl: 'https://cdn/p.jpg', webpPosterUrl: null });
    });

    it('страница списка: items и вложенные replies трансформируются', () => {
        const result = interceptor.transform({
            items: [comment({ replies: [comment({ uuid: 'r1', parentUuid: 'c1' })] })],
            total: 1,
            page: 1,
        });
        expect(result.total).toBe(1);
        expect(result.items[0].replies[0]).toMatchObject({ uuid: 'r1', parentUuid: 'c1' });
        expect(result.items[0].replies[0]).not.toHaveProperty('ipAddress');
    });

    it('модели Sequelize сериализуются через toJSON', () => {
        const model = { toJSON: () => comment() };
        expect(interceptor.transform(model).uuid).toBe('c1');
    });

    it('intercept оборачивает поток ответа', async () => {
        const result = await lastValueFrom(interceptor.intercept({} as any, { handle: () => of(comment()) }));
        expect(result).not.toHaveProperty('ipAddress');
    });

    it('transformFile(null) → null', () => {
        expect(interceptor.transformFile(null)).toBeNull();
    });
});
