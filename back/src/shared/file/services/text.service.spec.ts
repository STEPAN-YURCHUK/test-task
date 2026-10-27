import { TEXT_MAX_BYTES } from '../constants/file.const';
import { TextService } from './text.service';

describe('TextService', () => {
    const s3 = { putPublicObject: jest.fn() };
    const service = new TextService(s3 as any);

    beforeEach(() => jest.clearAllMocks());

    it('ровно 100 КБ — допустимо', () => {
        expect(() => service.validate(Buffer.alloc(TEXT_MAX_BYTES, 97))).not.toThrow();
    });

    it('больше 100 КБ → 400 file_text_too_large', () => {
        expect(() => service.validate(Buffer.alloc(TEXT_MAX_BYTES + 1, 97))).toThrow('file_text_too_large');
    });

    it('NUL-байт (бинарник) → 422 file_text_invalid', () => {
        try {
            service.validate(Buffer.from([65, 0, 66]));
        } catch (e: any) {
            expect(e.message).toBe('file_text_invalid');
            expect(e.getStatus()).toBe(422);
        }
        expect.assertions(2);
    });

    it('processAndUpload: text/plain utf-8, ключ .txt, без variants/video', async () => {
        const buffer = Buffer.from('Привет <script>');
        const result = await service.processAndUpload(buffer, 'comments/files/texts/u1');
        expect(s3.putPublicObject).toHaveBeenCalledWith('comments/files/texts/u1.txt', buffer, 'text/plain; charset=utf-8');
        expect(result).toEqual({
            type: 'TEXT',
            key: 'comments/files/texts/u1.txt',
            mimeType: 'text/plain',
            size: buffer.length,
            width: null,
            height: null,
            variants: null,
            video: null,
        });
    });

    it('processAndUpload: невалидный — ничего не пишет', async () => {
        await expect(service.processAndUpload(Buffer.from([0]), 'k')).rejects.toThrow('file_text_invalid');
        expect(s3.putPublicObject).not.toHaveBeenCalled();
    });
});
