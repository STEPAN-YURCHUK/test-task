import { BullModule } from '@nestjs/bull';
import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FILE_UPLOAD_QUEUE } from './constants/file.const';
import { ClientFileUploadController } from './controllers/client.file-upload.controller';
import { File } from './models/file.model';
import { FileUploadProcessor } from './processors/file-upload.processor';
import { FileUploadSessionRepository } from './repositories/file-upload-session.repository';
import { FileRepository } from './repositories/file.repository';
import { ClientFileService } from './services/client.file.service';
import { FileUploadService } from './services/file-upload.service';
import { ImageService } from './services/image.service';
import { TextService } from './services/text.service';
import { VideoService } from './services/video.service';

// Всё про файлы в одном месте: хранение (S3 + CDN), обработка, прямая multipart-загрузка.
// Доменные модули используют только ClientFileService.
@Global()
@Module({
    imports: [
        SequelizeModule.forFeature([File]),
        BullModule.registerQueue({
            name: FILE_UPLOAD_QUEUE,
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2_000 },
                removeOnComplete: 1000,
                removeOnFail: 1000,
            },
        }),
    ],
    controllers: [ClientFileUploadController],
    providers: [
        ClientFileService,
        FileUploadService,
        FileRepository,
        FileUploadSessionRepository,
        ImageService,
        TextService,
        VideoService,
        FileUploadProcessor,
    ],
    exports: [ClientFileService],
})
export class FileModule {}
