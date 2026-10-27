import { CompletedPart } from '@aws-sdk/client-s3';
import { writeFile, readFile, stat } from 'fs/promises';

// Подмена AwsS3Service для e2e: объекты и multipart-части в памяти, тот же контракт методов.
// Настоящий S3 (presigned PUT из браузера, CORS, CDN) проверяется Playwright-тестами.
export class InMemoryS3Service {
    readonly objects = new Map<string, { body: Buffer; contentType: string; public: boolean }>();
    private readonly uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
    private uploadSeq = 0;

    buildKey(...parts: string[]): string {
        return ['comments/e2e', ...parts].filter(Boolean).join('/');
    }

    getCdnUrl(key: string): string {
        return `https://cdn.test/${key}`;
    }

    async createMultipart(key: string): Promise<string> {
        const id = `upload-${++this.uploadSeq}`;
        this.uploads.set(id, { key, parts: new Map() });
        return id;
    }

    // «подписанная ссылка» — псевдо-URL, по которому тест кладёт кусок через putPart()
    async signPart(key: string, uploadId: string, partNumber: number, size: number): Promise<string> {
        return `memory://${uploadId}/${partNumber}?size=${size}&key=${encodeURIComponent(key)}`;
    }

    putPart(url: string, body: Buffer): void {
        const { host: uploadId, pathname } = new URL(url);
        this.uploads.get(uploadId).parts.set(Number(pathname.slice(1)), body);
    }

    async listParts(key: string, uploadId: string) {
        const upload = this.uploads.get(uploadId);
        const Parts = [...(upload?.parts ?? new Map()).entries()].map(([PartNumber, body]) => ({
            PartNumber,
            Size: body.length,
            ETag: `"etag-${PartNumber}"`,
        }));
        return { Parts };
    }

    async completeMultipart(key: string, uploadId: string, parts: CompletedPart[]) {
        const upload = this.uploads.get(uploadId);
        const body = Buffer.concat(parts.map((p) => upload.parts.get(p.PartNumber)));
        this.objects.set(key, { body, contentType: 'application/octet-stream', public: false });
        this.uploads.delete(uploadId);
        return {};
    }

    async abortMultipart(key: string, uploadId: string) {
        this.uploads.delete(uploadId);
        return {};
    }

    async head(key: string) {
        const object = this.objects.get(key);
        if (!object) throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
        return { ContentLength: object.body.length };
    }

    async readToBuffer(key: string, maxBytes: number): Promise<Buffer> {
        const object = this.objects.get(key);
        if (!object) throw new Error('s3_object_not_found');
        if (object.body.length > maxBytes) throw new Error('s3_object_too_large');
        return object.body;
    }

    async downloadToPath(key: string, targetPath: string): Promise<void> {
        await writeFile(targetPath, this.objects.get(key).body, { flag: 'wx' });
    }

    async putPublicObject(key: string, body: Buffer, contentType: string) {
        this.objects.set(key, { body, contentType, public: true });
        return {};
    }

    async putPublicObjectFromPath(key: string, sourcePath: string, contentType: string) {
        await stat(sourcePath);
        this.objects.set(key, { body: await readFile(sourcePath), contentType, public: true });
        return {};
    }

    async putPrivateObject(key: string, body: Buffer, contentType: string) {
        this.objects.set(key, { body, contentType, public: false });
        return {};
    }

    async deleteObject(key: string) {
        this.objects.delete(key);
        return {};
    }

    // ключ из CDN-URL, который вернул API
    keyFromUrl(url: string): string {
        return url.replace('https://cdn.test/', '');
    }
}
