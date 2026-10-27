import { ProcessedFile } from '../types/processed-file.type';

// Все объекты S3 результата обработки: основной файл + варианты картинки или постеры видео
export function processedFileKeys(result: ProcessedFile): string[] {
    const { variants, video } = result;
    return [
        result.key,
        ...(variants
            ? [variants.smallPath, variants.mediumPath, variants.webpSmallPath, variants.webpMediumPath, variants.webpOriginalPath]
            : []),
        ...(video ? [video.posterPath, video.webpPosterPath] : []),
    ];
}
