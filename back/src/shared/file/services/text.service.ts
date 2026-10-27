import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AwsS3Service } from 'src/infrastructure/aws-s3/services/aws-s3.service';
import { TEXT_MAX_BYTES } from '../constants/file.const';
import { TypeFileEnum } from '../enums/type-file.enum';
import { ProcessedFile } from '../types/processed-file.type';

@Injectable()
export class TextService {
    constructor(private readonly awsS3Service: AwsS3Service) {}

    validate(buffer: Buffer): void {
        if (buffer.length > TEXT_MAX_BYTES) throw new HttpException('file_text_too_large', HttpStatus.BAD_REQUEST);
        if (buffer.includes(0)) throw new HttpException('file_text_invalid', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    async processAndUpload(buffer: Buffer, keyBase: string): Promise<ProcessedFile> {
        this.validate(buffer);

        const key = `${keyBase}.txt`;
        await this.awsS3Service.putPublicObject(key, buffer, 'text/plain; charset=utf-8');

        return {
            type: TypeFileEnum.TEXT,
            key,
            mimeType: 'text/plain',
            size: buffer.length,
            width: null,
            height: null,
            variants: null,
            video: null,
        };
    }
}
