/**
 * Дозаполняет варианты (small / medium / webp-*) для картинок, загруженных до их появления.
 * Берёт original из S3, режет варианты той же логикой
 * ImageService.renderVariants, заливает и обновляет строку files.
 *
 *   npm run script:backfill-images            # обработать
 *   npm run script:backfill-images -- --dry-run   # только посчитать, без записи
 */
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { AppModule } from 'src/app.module';
import { AwsS3Service } from 'src/infrastructure/aws-s3/services/aws-s3.service';
import { IMAGE_SOURCE_MAX_BYTES } from 'src/shared/file/constants/file.const';
import { TypeFileEnum } from 'src/shared/file/enums/type-file.enum';
import { File } from 'src/shared/file/models/file.model';
import { ImageService } from 'src/shared/file/services/image.service';

async function run() {
    const dryRun = process.argv.includes('--dry-run');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

    const fileModel = app.get<typeof File>(getModelToken(File));
    const imageService = app.get(ImageService);
    const awsS3Service = app.get(AwsS3Service);

    const files = await fileModel.findAll({ where: { type: TypeFileEnum.IMAGE, smallPath: { [Op.is]: null } } });
    console.log(`Images without variants: ${files.length}${dryRun ? ' (dry run)' : ''}`);

    let done = 0;
    for (const file of files) {
        try {
            const source = await awsS3Service.readToBuffer(file.path, IMAGE_SOURCE_MAX_BYTES);
            if (dryRun) {
                const { variants } = await imageService.renderVariants(source);
                console.log(`would create ${variants.length} variants for ${file.path}`);
                continue;
            }

            // uuid файла как имя: новые варианты ложатся в папки small/medium/webp-* рядом
            const processed = await imageService.processAndUpload(source, file.uuid);
            const oldPath = file.path;
            await file.update({
                path: processed.key,
                size: processed.size,
                width: processed.width,
                height: processed.height,
                ...processed.variants,
            });
            if (oldPath !== processed.key) await awsS3Service.deleteObject(oldPath).catch(() => undefined);

            done++;
            console.log(`✓ ${oldPath} → ${processed.key}`);
        } catch (err) {
            console.error(`✗ ${file.path}: ${err?.message ?? err}`);
        }
    }

    console.log(`Done: ${done}/${files.length}`);
    await app.close();
}

run();
