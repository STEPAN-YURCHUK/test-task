import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
    ApiClientAbortUploadDocs,
    ApiClientCompleteUploadDocs,
    ApiClientInitUploadDocs,
    ApiClientRefreshUploadPartsDocs,
    ApiClientUploadStatusDocs,
} from '../docs/decorators/client.file-upload.swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { InitFileUploadDto } from '../dtos/init-file-upload.dto';
import { FileUploadService } from '../services/file-upload.service';
import { InitFileUploadInput } from '../types/init-file-upload-input.type';

@ApiTags('[Client] Upload')
@Controller('uploads')
export class ClientFileUploadController {
    constructor(private readonly fileUploadService: FileUploadService) {}

    @ApiClientInitUploadDocs()
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    @Post()
    async init(@Body() dto: InitFileUploadDto) {
        const input = { filename: dto.filename, size: dto.size } satisfies InitFileUploadInput;
        return await this.fileUploadService.init(input);
    }

    @ApiClientRefreshUploadPartsDocs()
    @HttpCode(HttpStatus.OK)
    @Post(':uploadId/parts')
    async parts(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
        return await this.fileUploadService.parts(uploadId);
    }

    @ApiClientCompleteUploadDocs()
    @HttpCode(HttpStatus.OK)
    @Post(':uploadId/complete')
    async complete(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
        return await this.fileUploadService.complete(uploadId);
    }

    @ApiClientUploadStatusDocs()
    @Get(':uploadId')
    async status(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
        return await this.fileUploadService.status(uploadId);
    }

    @ApiClientAbortUploadDocs()
    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete(':uploadId')
    async abort(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
        await this.fileUploadService.abort(uploadId);
    }
}
