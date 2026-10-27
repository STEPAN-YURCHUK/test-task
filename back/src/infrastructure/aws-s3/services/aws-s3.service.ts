import {
    AbortMultipartUploadCommand,
    CompletedPart,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListPartsCommand,
    ObjectCannedACL,
    PutObjectCommand,
    S3Client,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { getAwsS3ClientConfig } from 'src/config/aws-s3.config';

// Все ключи строятся сервером внутри S3_FOLDER; клиент ключей не передаёт никогда
@Injectable()
export class AwsS3Service {
    private readonly s3Client: S3Client;
    // Подпись presigned-URL включает хост. В docker бэкенд ходит в MinIO по http://minio:9000,
    // а браузер — по http://localhost:9000, поэтому ссылки для браузера подписываются отдельным клиентом
    private readonly presignClient: S3Client;
    private readonly bucketName: string;
    private readonly folder: string;
    private readonly cdnUrl: string;

    constructor(private readonly configService: ConfigService) {
        this.s3Client = new S3Client(getAwsS3ClientConfig(configService));
        const publicEndpoint = configService.get<string>('S3_PUBLIC_ENDPOINT');
        this.presignClient = publicEndpoint ? new S3Client(getAwsS3ClientConfig(configService, publicEndpoint)) : this.s3Client;
        this.bucketName = configService.get<string>('S3_BUCKET_NAME');
        this.folder = (configService.get<string>('S3_FOLDER') ?? '').replace(/\/+$/, '');
        this.cdnUrl = (configService.get<string>('S3_CDN_URL') ?? '').replace(/\/+$/, '');
    }

    buildKey(...parts: string[]): string {
        return [this.folder, ...parts].filter(Boolean).join('/');
    }

    getCdnUrl(key: string): string {
        return `${this.cdnUrl}/${key}`;
    }

    async createMultipart(key: string, contentType: string): Promise<string> {
        const result = await this.s3Client.send(
            new CreateMultipartUploadCommand({ Bucket: this.bucketName, Key: key, ContentType: contentType }),
        );
        if (!result.UploadId) throw new Error('multipart_upload_id_missing');
        return result.UploadId;
    }

    // Content-Length входит в подпись: залить в кусок больше заявленного нельзя
    signPart(key: string, uploadId: string, partNumber: number, size: number, expiresIn: number): Promise<string> {
        return getSignedUrl(
            this.presignClient,
            new UploadPartCommand({ Bucket: this.bucketName, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: size }),
            { expiresIn, signableHeaders: new Set(['content-length']) },
        );
    }

    listParts(key: string, uploadId: string) {
        return this.s3Client.send(new ListPartsCommand({ Bucket: this.bucketName, Key: key, UploadId: uploadId }));
    }

    completeMultipart(key: string, uploadId: string, parts: CompletedPart[]) {
        return this.s3Client.send(
            new CompleteMultipartUploadCommand({
                Bucket: this.bucketName,
                Key: key,
                UploadId: uploadId,
                MultipartUpload: { Parts: parts },
            }),
        );
    }

    abortMultipart(key: string, uploadId: string) {
        return this.s3Client.send(new AbortMultipartUploadCommand({ Bucket: this.bucketName, Key: key, UploadId: uploadId }));
    }

    head(key: string) {
        return this.s3Client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
    }

    async readToBuffer(key: string, maxBytes: number): Promise<Buffer> {
        const result = await this.s3Client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
        if (!result.Body) throw new Error('s3_object_body_missing');
        if (Number(result.ContentLength) > maxBytes) {
            (result.Body as Readable).destroy();
            throw new Error('s3_object_too_large');
        }

        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of result.Body as Readable) {
            total += chunk.length;
            if (total > maxBytes) {
                (result.Body as Readable).destroy();
                throw new Error('s3_object_too_large');
            }
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }

    // большие объекты (видео) — потоком на диск, без загрузки в память
    async downloadToPath(key: string, targetPath: string): Promise<void> {
        const result = await this.s3Client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
        if (!result.Body) throw new Error('s3_object_body_missing');
        await pipeline(result.Body as Readable, createWriteStream(targetPath, { flags: 'wx' }));
    }

    async putPublicObjectFromPath(key: string, sourcePath: string, contentType: string) {
        const { size } = await stat(sourcePath);
        const body = createReadStream(sourcePath);
        try {
            return await this.s3Client.send(
                new PutObjectCommand({
                    Bucket: this.bucketName,
                    Key: key,
                    Body: body,
                    ContentLength: size,
                    ContentType: contentType,
                    ACL: ObjectCannedACL.public_read,
                    CacheControl: 'public, max-age=31536000, immutable',
                }),
            );
        } finally {
            body.destroy();
        }
    }

    // готовые файлы публичные — раздаются через CDN
    putPublicObject(key: string, body: Buffer, contentType: string) {
        return this.s3Client.send(
            new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: body,
                ContentType: contentType,
                ACL: ObjectCannedACL.public_read,
                CacheControl: 'public, max-age=31536000, immutable',
            }),
        );
    }

    putPrivateObject(key: string, body: Buffer, contentType: string) {
        return this.s3Client.send(new PutObjectCommand({ Bucket: this.bucketName, Key: key, Body: body, ContentType: contentType }));
    }

    deleteObject(key: string) {
        return this.s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
    }
}
