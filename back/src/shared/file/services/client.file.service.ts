import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { Transaction } from 'sequelize';
import { AwsS3Service } from 'src/infrastructure/aws-s3/services/aws-s3.service';
import { DatabaseService } from 'src/infrastructure/database/services/database.service';
import { FileRepository } from '../repositories/file.repository';
import { FileModelRef } from '../types/file-model-ref.type';
import { ProcessedFile } from '../types/processed-file.type';
import { FileUploadService } from './file-upload.service';
import { ImageService } from './image.service';
import { TextService } from './text.service';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif'];

// Единая точка работы с файлами для доменных модулей.
// Файл принадлежит сущности через modelType/modelUuid/modelColumn.
@Injectable()
export class ClientFileService {
    constructor(
        private readonly fileRepository: FileRepository,
        private readonly fileUploadService: FileUploadService,
        private readonly imageService: ImageService,
        private readonly textService: TextService,
        private readonly awsS3Service: AwsS3Service,
        private readonly databaseService: DatabaseService,
    ) {}

    getPublicUrl(path: string): string {
        return this.awsS3Service.getCdnUrl(path);
    }

    // Старый путь: файл прямо в multipart-запросе сущности — обрабатывается сразу, в этом же запросе
    async upload(file: Express.Multer.File, ref: FileModelRef, transaction: Transaction) {
        return await this.databaseService.withTransaction({ transaction }, async (trx) => {
            // расширение — из полного имени, а обрезаем имя до 255 с сохранением расширения
            const fullName = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const ext = extname(fullName).toLowerCase();
            const originalName = fullName.length > 255 ? fullName.slice(0, 255 - ext.length) + ext : fullName;
            const uuid = randomUUID();

            let processed: ProcessedFile;
            if (ext === '.txt')
                processed = await this.textService.processAndUpload(file.buffer, this.awsS3Service.buildKey('files', 'texts', uuid));
            else if (IMAGE_EXTENSIONS.includes(ext)) processed = await this.imageService.processAndUpload(file.buffer, uuid);
            else throw new HttpException('file_type_not_allowed', HttpStatus.BAD_REQUEST);

            return await this.create(uuid, processed, originalName, ref, trx);
        });
    }

    // Прямая загрузка: файл уже загружен в S3 и обработан. finish() вызывается после коммита/отката транзакции
    async attachUploaded(uploadId: string, ref: FileModelRef, transaction: Transaction) {
        const { session, finish } = await this.fileUploadService.claim(uploadId);
        try {
            const file = await this.create(undefined, session.result, session.originalName, ref, transaction);
            return { file, finish };
        } catch (err) {
            await finish(false);
            throw err;
        }
    }

    private async create(
        uuid: string | undefined,
        processed: ProcessedFile,
        originalName: string,
        ref: FileModelRef,
        transaction: Transaction,
    ) {
        return await this.fileRepository.create(
            {
                ...(uuid ? { uuid } : {}),
                type: processed.type,
                path: processed.key,
                originalName,
                mimeType: processed.mimeType,
                size: processed.size,
                width: processed.width,
                height: processed.height,
                ...(processed.variants ?? {}),
                ...(processed.video ?? {}),
                ...ref,
            },
            transaction,
        );
    }
}
