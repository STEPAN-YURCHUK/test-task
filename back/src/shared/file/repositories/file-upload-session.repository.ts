import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/infrastructure/redis/redis.const';
import { UPLOAD_CLAIM_LOCK_MS, UPLOAD_SESSION_TTL_SECONDS } from '../constants/file.const';
import { UploadSession } from '../types/upload-session.type';

const sessionKey = (id: string) => `upload:${id}`;
const claimKey = (id: string) => `upload:${id}:claim`;

@Injectable()
export class FileUploadSessionRepository {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    async save(session: UploadSession): Promise<void> {
        await this.redis.set(sessionKey(session.id), JSON.stringify(session), 'EX', UPLOAD_SESSION_TTL_SECONDS);
    }

    async find(id: string): Promise<UploadSession | null> {
        const raw = await this.redis.get(sessionKey(id));
        return raw ? (JSON.parse(raw) as UploadSession) : null;
    }

    async remove(id: string): Promise<void> {
        await this.redis.del(sessionKey(id), claimKey(id));
    }

    // SET NX: только один запрос может прикреплять файл сессии одновременно
    async acquireClaim(id: string): Promise<boolean> {
        return (await this.redis.set(claimKey(id), '1', 'PX', UPLOAD_CLAIM_LOCK_MS, 'NX')) === 'OK';
    }

    async releaseClaim(id: string): Promise<void> {
        await this.redis.del(claimKey(id));
    }
}
