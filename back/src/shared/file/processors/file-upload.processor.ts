import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { HttpException, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { FILE_UPLOAD_QUEUE } from '../constants/file.const';
import { FileUploadService } from '../services/file-upload.service';
import { ProcessUploadJobData } from '../types/process-upload-job-data.type';

@Processor(FILE_UPLOAD_QUEUE)
export class FileUploadProcessor {
    private readonly logger = new Logger(FileUploadProcessor.name);

    constructor(private readonly fileUploadService: FileUploadService) {}

    @Process({ name: 'process-upload', concurrency: 4 })
    async handle(job: Job<ProcessUploadJobData>) {
        try {
            await this.fileUploadService.process(job.data.uploadId);
        } catch (err) {
            // битый файл: повторять бессмысленно — сразу FAILED с конкретной причиной
            if (err instanceof HttpException) {
                await job.discard();
                await this.fileUploadService.markFailed(job.data.uploadId, err.message);
                return;
            }
            throw err;
        }
    }

    @Process({ name: 'process-video', concurrency: 1 })
    async handleVideo(job: Job<ProcessUploadJobData>) {
        return this.handle(job);
    }

    @OnQueueFailed()
    async onFailed(job: Job<ProcessUploadJobData>, error: Error) {
        this.logger.error(`Upload job ${job.id} failed (attempt ${job.attemptsMade}): ${error.message}`);
        if (job.attemptsMade < (job.opts.attempts ?? 1)) return;

        await this.fileUploadService.markFailed(job.data.uploadId, 'file_processing_failed');
    }
}
