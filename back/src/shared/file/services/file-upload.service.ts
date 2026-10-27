import { InjectQueue } from '@nestjs/bull';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { AwsS3Service } from 'src/infrastructure/aws-s3/services/aws-s3.service';
import {
    FILE_EXTENSIONS,
    FILE_UPLOAD_QUEUE,
    IMAGE_SOURCE_MAX_BYTES,
    TEXT_MAX_BYTES,
    UPLOAD_PART_SIZE,
    UPLOAD_URL_TTL_SECONDS,
} from '../constants/file.const';
import { StatusUploadEnum } from '../enums/status-upload.enum';
import { TypeFileEnum } from '../enums/type-file.enum';
import { FileUploadSessionRepository } from '../repositories/file-upload-session.repository';
import { InitFileUploadInput } from '../types/init-file-upload-input.type';
import { ProcessedFile } from '../types/processed-file.type';
import { ProcessUploadJobData } from '../types/process-upload-job-data.type';
import { UploadPartUrl } from '../types/upload-part-url.type';
import { UploadSession } from '../types/upload-session.type';
import { processedFileKeys } from '../utils/processed-file.util';
import { ImageService } from './image.service';
import { TextService } from './text.service';
import { VideoService } from './video.service';

// Прямая загрузка: сервер выдаёт подписанные ссылки на куски, браузер кладёт их
// прямо в S3, после complete файл обрабатывается в очереди → READY. Сущность прикрепляет его через claim().
@Injectable()
export class FileUploadService {
    private readonly logger = new Logger(FileUploadService.name);

    constructor(
        private readonly fileUploadSessionRepository: FileUploadSessionRepository,
        private readonly awsS3Service: AwsS3Service,
        private readonly imageService: ImageService,
        private readonly textService: TextService,
        private readonly videoService: VideoService,
        @InjectQueue(FILE_UPLOAD_QUEUE) private readonly fileUploadQueue: Queue<ProcessUploadJobData>,
    ) {}

    async init(input: InitFileUploadInput) {
        const ext = extname(input.filename).slice(1).toLowerCase();
        const policy = FILE_EXTENSIONS[ext];
        if (!policy) throw new HttpException('file_type_not_allowed', HttpStatus.BAD_REQUEST);
        if (input.size > policy.maxSize) {
            const tooLarge = {
                [TypeFileEnum.TEXT]: 'file_text_too_large',
                [TypeFileEnum.IMAGE]: 'file_image_too_large',
                [TypeFileEnum.VIDEO]: 'file_video_too_large',
            };
            throw new HttpException(tooLarge[policy.type], HttpStatus.BAD_REQUEST);
        }

        const id = randomUUID();
        const sourceKey = this.awsS3Service.buildKey('uploads', id, `source.${ext}`);
        const s3UploadId = await this.awsS3Service.createMultipart(sourceKey, policy.contentType);

        const session: UploadSession = {
            id,
            status: StatusUploadEnum.UPLOADING,
            type: policy.type,
            originalName: input.filename,
            contentType: policy.contentType,
            size: input.size,
            partSize: UPLOAD_PART_SIZE,
            partCount: Math.max(1, Math.ceil(input.size / UPLOAD_PART_SIZE)),
            sourceKey,
            s3UploadId,
            result: null,
            error: null,
            createdAt: new Date().toISOString(),
        };
        await this.fileUploadSessionRepository.save(session);

        return { uploadId: id, partSize: session.partSize, expiresIn: UPLOAD_URL_TTL_SECONDS, parts: await this.signParts(session) };
    }

    // ссылки живут час: для долгой загрузки фронт просит новые
    async parts(id: string) {
        const session = await this.findOrFail(id);
        if (session.status !== StatusUploadEnum.UPLOADING) throw new HttpException('file_upload_not_ready', HttpStatus.CONFLICT);
        return { uploadId: id, partSize: session.partSize, expiresIn: UPLOAD_URL_TTL_SECONDS, parts: await this.signParts(session) };
    }

    async complete(id: string) {
        const session = await this.findOrFail(id);
        // повторный complete после сбоя постановки в очередь: сессия уже PROCESSING, а задачи могло не появиться.
        // Добавление идемпотентно (jobId = id сессии), так что существующая задача не дублируется
        if (session.status === StatusUploadEnum.PROCESSING) await this.enqueue(session);
        if (session.status !== StatusUploadEnum.UPLOADING) return this.toStatus(session);

        // что S3 реально получил: количество, номера и размеры кусков должны совпасть с заявленными
        const { Parts = [] } = await this.awsS3Service.listParts(session.sourceKey, session.s3UploadId);
        const uploaded = [...Parts].sort((a, b) => a.PartNumber - b.PartNumber);
        const valid =
            uploaded.length === session.partCount &&
            uploaded.every((part, i) => part.PartNumber === i + 1 && part.Size === this.partSize(session, i + 1));
        if (!valid) throw new HttpException('file_upload_incomplete', HttpStatus.CONFLICT);

        await this.awsS3Service.completeMultipart(
            session.sourceKey,
            session.s3UploadId,
            uploaded.map((part) => ({ PartNumber: part.PartNumber, ETag: part.ETag })),
        );

        const head = await this.awsS3Service.head(session.sourceKey);
        if (Number(head.ContentLength) !== session.size) throw new HttpException('file_upload_incomplete', HttpStatus.CONFLICT);

        session.status = StatusUploadEnum.PROCESSING;
        await this.fileUploadSessionRepository.save(session);
        await this.enqueue(session);

        return this.toStatus(session);
    }

    // jobId = id сессии: повторное добавление не дублирует обработку.
    // Видео — отдельный обработчик с concurrency 1. Таймаут Bull не ставим: он не убивает ffmpeg, и повтор
    // запустился бы параллельно ещё работающему процессу. Время ограничивает VideoService (SIGKILL каждого запуска)
    private async enqueue(session: UploadSession): Promise<void> {
        await this.fileUploadQueue.add(
            session.type === TypeFileEnum.VIDEO ? 'process-video' : 'process-upload',
            { uploadId: session.id },
            { jobId: session.id },
        );
    }

    async status(id: string) {
        return this.toStatus(await this.findOrFail(id));
    }

    async abort(id: string): Promise<void> {
        const session = await this.fileUploadSessionRepository.find(id);
        if (!session) return;

        await this.fileUploadSessionRepository.remove(id);
        if (session.status === StatusUploadEnum.UPLOADING) {
            await this.awsS3Service.abortMultipart(session.sourceKey, session.s3UploadId).catch(() => undefined);
        } else {
            // multipart уже собран — исходник лежит отдельным объектом (обработка его тоже удаляет, но могла не начаться)
            await this.awsS3Service.deleteObject(session.sourceKey).catch(() => undefined);
        }
        if (session.result) await this.deleteResult(session.result);
    }

    // Вызывается воркером очереди. Битый файл — HttpException (без повторов), сбой S3 — обычная ошибка (Bull повторит)
    async process(id: string): Promise<void> {
        const session = await this.fileUploadSessionRepository.find(id);
        if (!session || session.status !== StatusUploadEnum.PROCESSING) return;

        const result = session.type === TypeFileEnum.VIDEO ? await this.processVideo(session) : await this.processSmall(session);

        await this.awsS3Service.deleteObject(session.sourceKey).catch(() => undefined);

        // сессию отменили во время обработки — результат никому не нужен
        if (!(await this.fileUploadSessionRepository.find(id))) {
            await this.deleteResult(result);
            return;
        }
        await this.fileUploadSessionRepository.save({ ...session, status: StatusUploadEnum.READY, result });
        this.logger.log(`Upload ${id} ready: ${result.key}`);
    }

    private async deleteResult(result: ProcessedFile): Promise<void> {
        await Promise.all(processedFileKeys(result).map((key) => this.awsS3Service.deleteObject(key).catch(() => undefined)));
    }

    private async processSmall(session: UploadSession): Promise<ProcessedFile> {
        const maxBytes = session.type === TypeFileEnum.IMAGE ? IMAGE_SOURCE_MAX_BYTES : TEXT_MAX_BYTES;
        const source = await this.awsS3Service.readToBuffer(session.sourceKey, maxBytes);

        return session.type === TypeFileEnum.IMAGE
            ? await this.imageService.processAndUpload(source, session.id)
            : await this.textService.processAndUpload(source, this.awsS3Service.buildKey('files', 'texts', session.id));
    }

    // видео обрабатывается на диске во временной папке (до 200 МБ — не в память)
    private async processVideo(session: UploadSession): Promise<ProcessedFile> {
        const workDir = await mkdtemp(join(tmpdir(), 'comments-video-'));
        try {
            const sourcePath = join(workDir, `source${extname(session.sourceKey)}`);
            await this.awsS3Service.downloadToPath(session.sourceKey, sourcePath);
            const result = await this.videoService.processAndUpload(sourcePath, workDir, session.id);
            delete result.transcoded;
            return result;
        } finally {
            await rm(workDir, { recursive: true, force: true });
        }
    }

    async markFailed(id: string, error: string): Promise<void> {
        const session = await this.fileUploadSessionRepository.find(id);
        if (!session) return;

        await this.awsS3Service.deleteObject(session.sourceKey).catch(() => undefined);
        await this.fileUploadSessionRepository.save({ ...session, status: StatusUploadEnum.FAILED, error });
        this.logger.warn(`Upload ${id} failed: ${error}`);
    }

    // Одноразовая выдача готового файла. finish(true) после коммита удаляет сессию,
    // finish(false) при откате снимает блокировку — файл можно прикрепить повторно
    async claim(id: string): Promise<{ session: UploadSession & { result: ProcessedFile }; finish: (attached: boolean) => Promise<void> }> {
        const session = await this.findOrFail(id);
        if (session.status !== StatusUploadEnum.READY || !session.result)
            throw new HttpException('file_upload_not_ready', HttpStatus.CONFLICT);
        if (!(await this.fileUploadSessionRepository.acquireClaim(id)))
            throw new HttpException('file_upload_not_ready', HttpStatus.CONFLICT);

        return {
            session: session as UploadSession & { result: ProcessedFile },
            finish: async (attached) =>
                attached ? this.fileUploadSessionRepository.remove(id) : this.fileUploadSessionRepository.releaseClaim(id),
        };
    }

    private async signParts(session: UploadSession): Promise<UploadPartUrl[]> {
        return Promise.all(
            Array.from({ length: session.partCount }, async (_, i) => {
                const partNumber = i + 1;
                const size = this.partSize(session, partNumber);
                const url = await this.awsS3Service.signPart(
                    session.sourceKey,
                    session.s3UploadId,
                    partNumber,
                    size,
                    UPLOAD_URL_TTL_SECONDS,
                );
                return { partNumber, size, url };
            }),
        );
    }

    private partSize(session: UploadSession, partNumber: number): number {
        return partNumber < session.partCount ? session.partSize : session.size - session.partSize * (session.partCount - 1);
    }

    private async findOrFail(id: string): Promise<UploadSession> {
        const session = await this.fileUploadSessionRepository.find(id);
        if (!session) throw new HttpException('file_upload_not_found', HttpStatus.NOT_FOUND);
        return session;
    }

    private toStatus(session: UploadSession) {
        return {
            uploadId: session.id,
            status: session.status,
            error: session.error,
            file: session.result
                ? {
                      type: session.result.type,
                      url: this.awsS3Service.getCdnUrl(session.result.key),
                      originalName: session.originalName,
                      mimeType: session.result.mimeType,
                      size: session.result.size,
                      width: session.result.width,
                      height: session.result.height,
                      webpUrl: session.result.variants ? this.awsS3Service.getCdnUrl(session.result.variants.webpOriginalPath) : null,
                      posterUrl: session.result.video ? this.awsS3Service.getCdnUrl(session.result.video.webpPosterPath) : null,
                      duration: session.result.video?.duration ?? null,
                  }
                : null,
        };
    }
}
