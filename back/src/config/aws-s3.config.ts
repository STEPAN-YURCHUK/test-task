import { S3ClientConfig } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

// endpointOverride — адрес для presigned-ссылок, которые открывает браузер (см. S3_PUBLIC_ENDPOINT)
export const getAwsS3ClientConfig = (configService: ConfigService, endpointOverride?: string): S3ClientConfig => {
    const endpoint = endpointOverride || configService.get<string>('S3_ENDPOINT');

    return {
        region: configService.get<string>('S3_REGION'),
        ...(endpoint ? { endpoint } : {}),
        // MinIO и другие self-hosted S3 работают с путями вида /bucket/key, а не bucket.host
        forcePathStyle: configService.get<string>('S3_FORCE_PATH_STYLE') === 'true',
        credentials: {
            accessKeyId: configService.get<string>('S3_ACCESS_KEY_ID'),
            secretAccessKey: configService.get<string>('S3_SECRET_ACCESS_KEY'),
        },
        // браузер сам присылает байты кусков — подписываем без checksum пустого тела
        requestChecksumCalculation: 'WHEN_REQUIRED',
    };
};
