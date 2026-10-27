import * as sharp from 'sharp';
import { TypeFileEnum } from '../enums/type-file.enum';
import { ImageService } from './image.service';

const solid = (width: number, height: number, format: 'png' | 'jpeg' | 'gif' = 'png') =>
    sharp({ create: { width, height, channels: 3, background: '#3366ff' } })
        [format]()
        .toBuffer();

const animatedGif = async () => {
    const frames = await Promise.all(
        ['#f00', '#0f0', '#00f'].map((c) =>
            sharp({ create: { width: 640, height: 480, channels: 3, background: c } })
                .png()
                .toBuffer(),
        ),
    );
    return sharp(frames, { join: { animated: true } })
        .gif()
        .toBuffer();
};

const createS3 = () => ({
    buildKey: jest.fn((...parts: string[]) => ['comments/test', ...parts].join('/')),
    putPublicObject: jest.fn().mockResolvedValue(undefined),
});

describe('ImageService', () => {
    describe('detectFormat', () => {
        it.each([
            ['png', 'png', { ext: 'png', mimeType: 'image/png' }],
            ['jpeg', 'jpeg', { ext: 'jpg', mimeType: 'image/jpeg' }],
            ['gif', 'gif', { ext: 'gif', mimeType: 'image/gif' }],
        ] as const)('%s', async (_, format, expected) => {
            expect(await new ImageService(createS3() as any).detectFormat(await solid(10, 10, format))).toEqual(expected);
        });

        it('битые данные → 422 file_image_invalid', async () => {
            await expect(new ImageService(createS3() as any).detectFormat(Buffer.from('not an image'))).rejects.toMatchObject({
                message: 'file_image_invalid',
                status: 422,
            });
        });

        it('неподдерживаемый формат (webp) → file_image_invalid', async () => {
            const webp = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#000' } })
                .webp()
                .toBuffer();
            await expect(new ImageService(createS3() as any).detectFormat(webp)).rejects.toThrow('file_image_invalid');
        });
    });

    describe('renderVariants', () => {
        it('большая картинка: 6 вариантов, каждый вписан в свой бокс с сохранением пропорций', async () => {
            const { format, variants } = await new ImageService(createS3() as any).renderVariants(await solid(1000, 500));
            expect(format.ext).toBe('png');
            expect(variants).toHaveLength(6);

            const pick = (name: string, isWebp: boolean) => variants.find((v) => v.name === name && v.isWebp === isWebp);
            for (const isWebp of [false, true]) {
                expect(pick('small', isWebp)).toMatchObject({ width: 160, height: 80 });
                expect(pick('medium', isWebp)).toMatchObject({ width: 240, height: 120 });
                expect(pick('original', isWebp)).toMatchObject({ width: 320, height: 160 });
            }
            expect((await sharp(pick('medium', true).data).metadata()).format).toBe('webp');
            expect((await sharp(pick('medium', false).data).metadata()).format).toBe('png');
        });

        it('вертикальная картинка ограничивается по высоте', async () => {
            const { variants } = await new ImageService(createS3() as any).renderVariants(await solid(300, 900));
            expect(variants.find((v) => v.name === 'original' && !v.isWebp)).toMatchObject({ width: 80, height: 240 });
            expect(variants.find((v) => v.name === 'small' && !v.isWebp)).toMatchObject({ width: 40, height: 120 });
        });

        it('маленькая картинка не увеличивается', async () => {
            const { variants } = await new ImageService(createS3() as any).renderVariants(await solid(100, 50, 'jpeg'));
            variants.forEach((v) => expect(v).toMatchObject({ width: 100, height: 50 }));
        });

        it('анимированный GIF остаётся анимированным, высота — высота кадра', async () => {
            const { format, variants } = await new ImageService(createS3() as any).renderVariants(await animatedGif());
            expect(format.ext).toBe('gif');
            const original = variants.find((v) => v.name === 'original' && !v.isWebp);
            const webp = variants.find((v) => v.name === 'original' && v.isWebp);
            expect(original).toMatchObject({ width: 320, height: 240 });
            expect((await sharp(original.data, { animated: true }).metadata()).pages).toBe(3);
            expect(await sharp(webp.data, { animated: true }).metadata()).toMatchObject({ format: 'webp', pages: 3 });
        });

        it('EXIF-ориентация применяется (rotate)', async () => {
            const rotated = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#fff' } })
                .jpeg()
                .withMetadata({ orientation: 6 })
                .toBuffer();
            const { variants } = await new ImageService(createS3() as any).renderVariants(rotated);
            expect(variants.find((v) => v.name === 'original' && !v.isWebp)).toMatchObject({ width: 120, height: 240 });
        });
    });

    describe('processAndUpload', () => {
        it('заливает 6 публичных объектов (оригинал, варианты и webp) и возвращает пути/размеры', async () => {
            const s3 = createS3();
            const result = await new ImageService(s3 as any).processAndUpload(await solid(1000, 500), 'uuid-1');

            expect(s3.putPublicObject).toHaveBeenCalledTimes(6);
            const keys = s3.putPublicObject.mock.calls.map((c) => c[0]).sort();
            expect(keys).toEqual(
                [
                    'comments/test/files/images/medium/uuid-1.png',
                    'comments/test/files/images/original/uuid-1.png',
                    'comments/test/files/images/small/uuid-1.png',
                    'comments/test/files/images/webp-medium/uuid-1.webp',
                    'comments/test/files/images/webp-original/uuid-1.webp',
                    'comments/test/files/images/webp-small/uuid-1.webp',
                ].sort(),
            );
            const webpCall = s3.putPublicObject.mock.calls.find((c) => c[0].endsWith('.webp'));
            expect(webpCall[2]).toBe('image/webp');

            expect(result).toMatchObject({
                type: TypeFileEnum.IMAGE,
                key: 'comments/test/files/images/original/uuid-1.png',
                mimeType: 'image/png',
                width: 320,
                height: 160,
                video: null,
                variants: {
                    smallPath: 'comments/test/files/images/small/uuid-1.png',
                    mediumPath: 'comments/test/files/images/medium/uuid-1.png',
                    webpSmallPath: 'comments/test/files/images/webp-small/uuid-1.webp',
                    webpMediumPath: 'comments/test/files/images/webp-medium/uuid-1.webp',
                    webpOriginalPath: 'comments/test/files/images/webp-original/uuid-1.webp',
                    smallWidth: 160,
                    smallHeight: 80,
                    mediumWidth: 240,
                    mediumHeight: 120,
                },
            });
            expect(result.size).toBeGreaterThan(0);
        });

        it('битая картинка — в S3 ничего не пишется', async () => {
            const s3 = createS3();
            await expect(new ImageService(s3 as any).processAndUpload(Buffer.from('xx'), 'u')).rejects.toThrow('file_image_invalid');
            expect(s3.putPublicObject).not.toHaveBeenCalled();
        });
    });
});
