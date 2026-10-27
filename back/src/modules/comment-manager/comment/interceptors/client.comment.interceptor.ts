import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { ClientFileService } from 'src/shared/file/services/client.file.service';

// Приводит комментарий (одиночный, страницу списка или вложенные replies) к публичному виду:
// path файла (ключ S3) → CDN url, внутренние поля (ip, userAgent, userUuid) не отдаются.
@Injectable()
export class TransformResponseClientCommentInterceptor implements NestInterceptor {
    constructor(private readonly clientFileService: ClientFileService) {}

    intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(map((data) => this.transform(data)));
    }

    transform(data: any) {
        const json = JSON.parse(JSON.stringify(data));

        if (Array.isArray(json?.items)) {
            return { ...json, items: json.items.map((item) => this.transformComment(item)) };
        }

        return this.transformComment(json);
    }

    transformFile(file: any) {
        if (!file) return null;

        return {
            uuid: file.uuid,
            type: file.type,
            url: this.clientFileService.getPublicUrl(file.path),
            originalName: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
            width: file.width ?? null,
            height: file.height ?? null,
            // варианты картинки для srcset (у текстовых файлов и старых картинок без backfill — null)
            variants: file.smallPath
                ? {
                      small: this.variant(file.smallPath, file.webpSmallPath, file.smallWidth, file.smallHeight),
                      medium: this.variant(file.mediumPath, file.webpMediumPath, file.mediumWidth, file.mediumHeight),
                      original: this.variant(file.path, file.webpOriginalPath, file.width, file.height),
                  }
                : null,
            // видео: mp4 (H.264/AAC) + постер-кадр; null у картинок и текстов
            video: file.posterPath
                ? {
                      duration: file.duration !== null && file.duration !== undefined ? Number(file.duration) : null,
                      posterUrl: this.clientFileService.getPublicUrl(file.posterPath),
                      webpPosterUrl: file.webpPosterPath ? this.clientFileService.getPublicUrl(file.webpPosterPath) : null,
                  }
                : null,
        };
    }

    private variant(path: string, webpPath: string | null, width: number, height: number) {
        return {
            url: this.clientFileService.getPublicUrl(path),
            webpUrl: webpPath ? this.clientFileService.getPublicUrl(webpPath) : null,
            width,
            height,
        };
    }

    private transformComment(comment: any) {
        if (!comment) return comment;

        return {
            uuid: comment.uuid,
            parentUuid: comment.parentUuid,
            rootUuid: comment.rootUuid,
            text: comment.text,
            likesCount: comment.likesCount ?? 0,
            dislikesCount: comment.dislikesCount ?? 0,
            createdAt: comment.createdAt,
            user: comment.user ? { userName: comment.user.userName, email: comment.user.email, homePage: comment.user.homePage } : null,
            file: this.transformFile(comment.file),
            ...(Array.isArray(comment.replies) ? { replies: comment.replies.map((reply) => this.transformComment(reply)) } : {}),
        };
    }
}
