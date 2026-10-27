import { TypeFileEnum } from '../enums/type-file.enum';

export interface IFileAttrs {
    uuid?: string;
    type: TypeFileEnum;
    path: string;
    originalName: string;
    mimeType: string;
    size: number;
    width?: number | null;
    height?: number | null;
    smallPath?: string | null;
    mediumPath?: string | null;
    webpSmallPath?: string | null;
    webpMediumPath?: string | null;
    webpOriginalPath?: string | null;
    smallWidth?: number | null;
    smallHeight?: number | null;
    mediumWidth?: number | null;
    mediumHeight?: number | null;
    duration?: number | null;
    posterPath?: string | null;
    webpPosterPath?: string | null;
    modelUuid: string;
    modelType: string;
    modelColumn: string;
}
