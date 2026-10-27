import { TypeFileEnum } from '../enums/type-file.enum';

// Варианты картинки: ключи S3 и размеры (original = key/width/height основного файла)
export type ProcessedImageVariants = {
    smallPath: string;
    mediumPath: string;
    webpSmallPath: string;
    webpMediumPath: string;
    webpOriginalPath: string;
    smallWidth: number;
    smallHeight: number;
    mediumWidth: number;
    mediumHeight: number;
};

// Видео: длительность и постер (кадр) в jpg + webp
export type ProcessedVideoMeta = {
    duration: number;
    posterPath: string;
    webpPosterPath: string;
};

// Результат обработки: файл уже лежит в S3 публично под key
export type ProcessedFile = {
    type: TypeFileEnum;
    key: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    variants: ProcessedImageVariants | null;
    video: ProcessedVideoMeta | null;
};
