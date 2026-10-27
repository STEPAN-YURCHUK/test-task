import {
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListPartsCommand,
    AbortMultipartUploadCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { AwsS3Service } from './aws-s3.service';

const config = (values: Record<string, any>) => ({ get: (key: string) => values[key] }) as any;
const baseConfig = {
    S3_REGION: 'ams3',
    S3_ENDPOINT: 'https://ams3.digitaloceanspaces.com',
    S3_BUCKET_NAME: 'bucket',
    S3_FOLDER: 'comments/dev/',
    S3_CDN_URL: 'https://cdn.example.com/',
    S3_ACCESS_KEY_ID: 'AKIA',
    S3_SECRET_ACCESS_KEY: 'secret',
};

describe('AwsS3Service', () => {
    let send: jest.SpyInstance;
    let service: AwsS3Service;

    beforeEach(() => {
        send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
        service = new AwsS3Service(config(baseConfig));
    });
    afterEach(() => jest.restoreAllMocks());

    const lastCommand = () => send.mock.calls[send.mock.calls.length - 1][0];

    it('buildKey: папка без хвостового слеша, пустые части пропускаются', () => {
        expect(service.buildKey('files', '', 'a.png')).toBe('comments/dev/files/a.png');
    });

    it('buildKey без S3_FOLDER', () => {
        expect(new AwsS3Service(config({ ...baseConfig, S3_FOLDER: undefined })).buildKey('a')).toBe('a');
    });

    it('getCdnUrl: без двойного слеша; без S3_CDN_URL — относительный', () => {
        expect(service.getCdnUrl('k/a.png')).toBe('https://cdn.example.com/k/a.png');
        expect(new AwsS3Service(config({ ...baseConfig, S3_CDN_URL: undefined })).getCdnUrl('k')).toBe('/k');
    });

    it('createMultipart → UploadId', async () => {
        send.mockResolvedValueOnce({ UploadId: 'up-1' } as never);
        expect(await service.createMultipart('k', 'image/png')).toBe('up-1');
        expect(lastCommand()).toBeInstanceOf(CreateMultipartUploadCommand);
        expect(lastCommand().input).toEqual({ Bucket: 'bucket', Key: 'k', ContentType: 'image/png' });
    });

    it('createMultipart без UploadId → ошибка', async () => {
        send.mockResolvedValueOnce({} as never);
        await expect(service.createMultipart('k', 'x')).rejects.toThrow('multipart_upload_id_missing');
    });

    it('signPart: подписанная ссылка с partNumber и content-length в подписи', async () => {
        const url = new URL(await service.signPart('comments/dev/uploads/u/source.png', 'up-1', 2, 1234, 3600));
        expect(url.host).toContain('digitaloceanspaces.com');
        expect(url.searchParams.get('partNumber')).toBe('2');
        expect(url.searchParams.get('uploadId')).toBe('up-1');
        expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
        expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    });

    it('MinIO в docker: ссылки для браузера подписаны публичным адресом, серверные запросы идут на внутренний (path-style)', async () => {
        const minio = new AwsS3Service(
            config({
                ...baseConfig,
                S3_ENDPOINT: 'http://minio:9000',
                S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
                S3_FORCE_PATH_STYLE: 'true',
            }),
        );

        const url = new URL(await minio.signPart('comments/dev/uploads/u/source.png', 'up-1', 1, 10, 60));
        expect(url.origin).toBe('http://localhost:9000');
        // path-style: /bucket/key, без bucket в имени хоста
        expect(url.pathname).toBe('/bucket/comments/dev/uploads/u/source.png');

        await minio.head('k');
        const client = send.mock.contexts[send.mock.contexts.length - 1] as S3Client;
        expect(await client.config.endpoint()).toMatchObject({ hostname: 'minio', port: 9000 });
        expect(client.config.forcePathStyle).toBe(true);
    });

    it('listParts / completeMultipart / abortMultipart / head / deleteObject', async () => {
        await service.listParts('k', 'u');
        expect(lastCommand()).toBeInstanceOf(ListPartsCommand);
        await service.completeMultipart('k', 'u', [{ PartNumber: 1, ETag: 'e' }]);
        expect(lastCommand()).toBeInstanceOf(CompleteMultipartUploadCommand);
        expect(lastCommand().input.MultipartUpload).toEqual({ Parts: [{ PartNumber: 1, ETag: 'e' }] });
        await service.abortMultipart('k', 'u');
        expect(lastCommand()).toBeInstanceOf(AbortMultipartUploadCommand);
        await service.head('k');
        expect(lastCommand()).toBeInstanceOf(HeadObjectCommand);
        await service.deleteObject('k');
        expect(lastCommand()).toBeInstanceOf(DeleteObjectCommand);
        expect(lastCommand().input).toEqual({ Bucket: 'bucket', Key: 'k' });
    });

    describe('readToBuffer', () => {
        it('читает поток целиком', async () => {
            send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('ab'), Buffer.from('c')]), ContentLength: 3 } as never);
            expect((await service.readToBuffer('k', 10)).toString()).toBe('abc');
            expect(lastCommand()).toBeInstanceOf(GetObjectCommand);
        });

        it('ContentLength больше лимита → s3_object_too_large без чтения', async () => {
            const body = Readable.from([Buffer.from('x')]);
            const destroy = jest.spyOn(body, 'destroy');
            send.mockResolvedValueOnce({ Body: body, ContentLength: 100 } as never);
            await expect(service.readToBuffer('k', 10)).rejects.toThrow('s3_object_too_large');
            expect(destroy).toHaveBeenCalled();
        });

        it('поток длиннее лимита (ContentLength врёт) → s3_object_too_large', async () => {
            send.mockResolvedValueOnce({ Body: Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), ContentLength: 1 } as never);
            await expect(service.readToBuffer('k', 10)).rejects.toThrow('s3_object_too_large');
        });

        it('без Body → ошибка', async () => {
            send.mockResolvedValueOnce({} as never);
            await expect(service.readToBuffer('k', 10)).rejects.toThrow('s3_object_body_missing');
        });
    });

    it('putPublicObject: public-read и долгий кеш', async () => {
        await service.putPublicObject('k', Buffer.from('x'), 'image/png');
        expect(lastCommand()).toBeInstanceOf(PutObjectCommand);
        expect(lastCommand().input).toMatchObject({
            Bucket: 'bucket',
            Key: 'k',
            ContentType: 'image/png',
            ACL: 'public-read',
            CacheControl: 'public, max-age=31536000, immutable',
        });
    });

    it('putPrivateObject: без ACL', async () => {
        await service.putPrivateObject('k', Buffer.from('x'), 'text/plain');
        expect(lastCommand().input.ACL).toBeUndefined();
    });

    describe('потоковые операции с диском', () => {
        let dir: string;
        beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 's3-spec-'))));
        afterEach(async () => rm(dir, { recursive: true, force: true }));

        it('downloadToPath пишет файл', async () => {
            send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('video')]) } as never);
            await service.downloadToPath('k', join(dir, 'a.mp4'));
            expect((await readFile(join(dir, 'a.mp4'))).toString()).toBe('video');
        });

        it('downloadToPath без Body → ошибка', async () => {
            send.mockResolvedValueOnce({} as never);
            await expect(service.downloadToPath('k', join(dir, 'b'))).rejects.toThrow('s3_object_body_missing');
        });

        it('putPublicObjectFromPath: ContentLength из файла, public-read', async () => {
            await writeFile(join(dir, 'v.mp4'), Buffer.alloc(42));
            await service.putPublicObjectFromPath('k', join(dir, 'v.mp4'), 'video/mp4');
            expect(lastCommand().input).toMatchObject({ Key: 'k', ContentLength: 42, ContentType: 'video/mp4', ACL: 'public-read' });
        });
    });
});
