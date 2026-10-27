import { StatusUploadEnum } from '../enums/status-upload.enum';
import { TypeFileEnum } from '../enums/type-file.enum';
import { ProcessedFile } from './processed-file.type';

// Сессия прямой загрузки (Redis). id сессии — неугадываемый uuid и одновременно право на неё:
// регистрации нет, как и у комментариев
export type UploadSession = {
    id: string;
    status: StatusUploadEnum;
    type: TypeFileEnum;
    originalName: string;
    contentType: string;
    size: number;
    partSize: number;
    partCount: number;
    sourceKey: string;
    s3UploadId: string;
    result: ProcessedFile | null;
    error: string | null;
    createdAt: string;
};
