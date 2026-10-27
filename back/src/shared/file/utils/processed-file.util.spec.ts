import { TypeFileEnum } from '../enums/type-file.enum';
import { processedFileKeys } from './processed-file.util';

const base = {
    type: TypeFileEnum.TEXT,
    key: 'f.txt',
    mimeType: 'text/plain',
    size: 1,
    width: null,
    height: null,
    variants: null,
    video: null,
};

describe('processedFileKeys', () => {
    it('текст — только основной файл', () => {
        expect(processedFileKeys(base)).toEqual(['f.txt']);
    });

    it('картинка — основной файл и 5 вариантов', () => {
        const variants = {
            smallPath: 's',
            mediumPath: 'm',
            webpSmallPath: 'ws',
            webpMediumPath: 'wm',
            webpOriginalPath: 'wo',
            smallWidth: 1,
            smallHeight: 1,
            mediumWidth: 1,
            mediumHeight: 1,
        };
        expect(processedFileKeys({ ...base, type: TypeFileEnum.IMAGE, key: 'o', variants })).toEqual(['o', 's', 'm', 'ws', 'wm', 'wo']);
    });

    it('видео — файл и оба постера', () => {
        expect(processedFileKeys({ ...base, key: 'v.mp4', video: { duration: 1, posterPath: 'p.jpg', webpPosterPath: 'p.webp' } })).toEqual(
            ['v.mp4', 'p.jpg', 'p.webp'],
        );
    });
});
