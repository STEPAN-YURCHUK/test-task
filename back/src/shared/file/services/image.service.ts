import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as sharp from 'sharp';
import { AwsS3Service } from 'src/infrastructure/aws-s3/services/aws-s3.service';
import { IMAGE_FORMATS, IMAGE_VARIANTS, IMAGE_WEBP_QUALITY } from '../constants/file.const';
import { TypeFileEnum } from '../enums/type-file.enum';
import { ProcessedFile } from '../types/processed-file.type';

type VariantName = (typeof IMAGE_VARIANTS)[number]['name'];
type RenderedVariant = { name: VariantName; isWebp: boolean; data: Buffer; width: number; height: number };

@Injectable()
export class ImageService {
    constructor(private readonly awsS3Service: AwsS3Service) {}

    // Формат — по содержимому, а не по имени/mime от клиента
    async detectFormat(buffer: Buffer) {
        const format = await sharp(buffer)
            .metadata()
            .then((meta) => IMAGE_FORMATS[meta.format])
            .catch(() => null);
        if (!format) throw new HttpException('file_image_invalid', HttpStatus.UNPROCESSABLE_ENTITY);
        return format;
    }

    // Ключ варианта: <S3_FOLDER>/files/images/<small|medium|original|webp-…>/<uuid>.<ext>
    buildVariantKey(variant: string, uuid: string, ext: string): string {
        return this.awsS3Service.buildKey('files', 'images', variant, `${uuid}.${ext}`);
    }

    // Три размера × два формата (исходный и webp). Каждый вариант пропорционально вписан в свой бокс
    // без увеличения, GIF остаётся анимированным (и в webp тоже). Перекодирование отбрасывает EXIF и полиглоты.
    async renderVariants(buffer: Buffer): Promise<{ format: { ext: string; mimeType: string }; variants: RenderedVariant[] }> {
        const format = await this.detectFormat(buffer);

        const variants = await Promise.all(
            IMAGE_VARIANTS.flatMap(({ name, width, height }) =>
                [false, true].map(async (isWebp) => {
                    let pipeline = sharp(buffer, { animated: true })
                        .rotate()
                        .resize(width, height, { fit: 'inside', withoutEnlargement: true });
                    if (isWebp) pipeline = pipeline.webp({ quality: IMAGE_WEBP_QUALITY });

                    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
                    // для анимированных GIF info.height — высота всей ленты кадров
                    return { name, isWebp, data, width: info.width, height: info.pageHeight ?? info.height };
                }),
            ),
        );

        return { format, variants };
    }

    async processAndUpload(buffer: Buffer, uuid: string): Promise<ProcessedFile> {
        const { format, variants } = await this.renderVariants(buffer);
        const keyOf = (variant: RenderedVariant) =>
            this.buildVariantKey(variant.isWebp ? `webp-${variant.name}` : variant.name, uuid, variant.isWebp ? 'webp' : format.ext);

        await Promise.all(
            variants.map((variant) =>
                this.awsS3Service.putPublicObject(keyOf(variant), variant.data, variant.isWebp ? 'image/webp' : format.mimeType),
            ),
        );

        const find = (name: VariantName, isWebp = false) => variants.find((v) => v.name === name && v.isWebp === isWebp);
        const original = find('original');
        const small = find('small');
        const medium = find('medium');

        return {
            type: TypeFileEnum.IMAGE,
            key: keyOf(original),
            mimeType: format.mimeType,
            size: original.data.length,
            width: original.width,
            height: original.height,
            variants: {
                smallPath: keyOf(small),
                mediumPath: keyOf(medium),
                webpSmallPath: keyOf(find('small', true)),
                webpMediumPath: keyOf(find('medium', true)),
                webpOriginalPath: keyOf(find('original', true)),
                smallWidth: small.width,
                smallHeight: small.height,
                mediumWidth: medium.width,
                mediumHeight: medium.height,
            },
            video: null,
        };
    }
}
