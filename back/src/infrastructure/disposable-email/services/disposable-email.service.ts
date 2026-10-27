import { HttpException, HttpStatus, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from 'src/infrastructure/redis/redis.const';
import {
    DISPOSABLE_EMAIL_CACHE_KEY,
    DISPOSABLE_EMAIL_CACHE_TTL_SECONDS,
    DISPOSABLE_EMAIL_DOWNLOAD_ATTEMPTS,
    DISPOSABLE_EMAIL_DOWNLOAD_TIMEOUT_MS,
    DISPOSABLE_EMAIL_LOCK_KEY,
    DISPOSABLE_EMAIL_LOCK_TTL_SECONDS,
    DISPOSABLE_EMAIL_MANUAL_ALLOWLIST,
    DISPOSABLE_EMAIL_MANUAL_BLOCKLIST,
    DISPOSABLE_EMAIL_REFRESH_INTERVAL_MS,
    DISPOSABLE_EMAIL_SOURCES,
} from '../constants/disposable-email.const';
import { domainCandidates, getEmailDomain, parseDomainList } from '../utils/email-domain.util';

// Одноразовые («временные») почтовые адреса: два публичных списка доменов, объединённые, плюс ручные block/allow-списки; проверяется домен и все его родители.
// Список живёт в памяти, кешируется в Redis на 7 дней и обновляется раз в сутки. Загрузка идёт в фоне: пока списка
// нет (первые секунды старта или недоступный GitHub), домены не проверяются — внешний сайт не должен закрывать
// отправку комментариев. DISPOSABLE_EMAIL_AUTO_REFRESH=false отключает загрузку при старте и по таймеру (тесты).
@Injectable()
export class DisposableEmailService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(DisposableEmailService.name);
    private readonly allowlist = new Set(DISPOSABLE_EMAIL_MANUAL_ALLOWLIST);
    private readonly manualBlocklist = new Set(DISPOSABLE_EMAIL_MANUAL_BLOCKLIST);
    private blocklist = new Set<string>();
    private timer: NodeJS.Timeout | null = null;

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    onApplicationBootstrap() {
        if (process.env.DISPOSABLE_EMAIL_AUTO_REFRESH === 'false') return;

        void this.loadFromCacheOrRefresh();
        this.timer = setInterval(() => void this.refresh(), DISPOSABLE_EMAIL_REFRESH_INTERVAL_MS);
        this.timer.unref();
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer);
    }

    get loadedCount(): number {
        return this.blocklist.size;
    }

    checkNotDisposableOrThrow(email: string): void {
        if (this.isDisposable(email)) throw new HttpException('disposable_email_not_allowed', HttpStatus.BAD_REQUEST);
    }

    isDisposable(email: string): boolean {
        const domain = getEmailDomain(email);
        if (!domain) return false;

        for (const candidate of domainCandidates(domain)) {
            if (this.allowlist.has(candidate)) return false;
            if (this.manualBlocklist.has(candidate) || this.blocklist.has(candidate)) return true;
        }
        return false;
    }

    async loadFromCacheOrRefresh(): Promise<void> {
        try {
            const cached = await this.redis.get(DISPOSABLE_EMAIL_CACHE_KEY);
            if (cached) {
                this.blocklist = new Set(JSON.parse(cached) as string[]);
                this.logger.log(`Disposable email list loaded from Redis: ${this.blocklist.size} domains`);
                return;
            }
        } catch (err) {
            this.logger.warn(`Disposable email cache unavailable: ${err?.message ?? err}`);
        }
        await this.refresh();
    }

    // Перечитать оба источника. Ничего не скачалось — остаётся прежний список. Никогда не бросает
    async refresh(): Promise<void> {
        if (!(await this.acquireLock())) {
            this.logger.log('Disposable email list refresh skipped: another instance is refreshing');
            return;
        }

        try {
            const texts = await Promise.all(DISPOSABLE_EMAIL_SOURCES.map((url) => this.download(url)));
            const merged = new Set<string>();
            for (const text of texts) for (const domain of parseDomainList(text)) merged.add(domain);
            for (const domain of this.allowlist) merged.delete(domain);

            if (!merged.size) {
                this.logger.warn('Disposable email lists are empty or unavailable, keeping the previous list');
                return;
            }

            this.blocklist = merged;
            this.logger.log(`Disposable email list refreshed: ${merged.size} domains`);
            await this.redis
                .set(DISPOSABLE_EMAIL_CACHE_KEY, JSON.stringify([...merged]), 'EX', DISPOSABLE_EMAIL_CACHE_TTL_SECONDS)
                .catch((err) => this.logger.warn(`Disposable email cache not saved: ${err?.message ?? err}`));
        } finally {
            await this.redis.del(DISPOSABLE_EMAIL_LOCK_KEY).catch(() => undefined);
        }
    }

    // Redis недоступен — обновляемся без блокировки, а не пропускаем обновление
    private async acquireLock(): Promise<boolean> {
        try {
            return (
                (await this.redis.set(DISPOSABLE_EMAIL_LOCK_KEY, String(Date.now()), 'EX', DISPOSABLE_EMAIL_LOCK_TTL_SECONDS, 'NX')) ===
                'OK'
            );
        } catch {
            return true;
        }
    }

    // Повторы с паузой 1 с, 2 с; источник так и не ответил — пустая строка (второй источник может спасти)
    private async download(url: string): Promise<string> {
        for (let attempt = 1; attempt <= DISPOSABLE_EMAIL_DOWNLOAD_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(url, {
                    headers: { 'User-Agent': 'comments-disposable-email-checker', Accept: 'text/plain,*/*' },
                    signal: AbortSignal.timeout(DISPOSABLE_EMAIL_DOWNLOAD_TIMEOUT_MS),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.text();
            } catch (err) {
                this.logger.warn(`Disposable email source ${url} failed (attempt ${attempt}): ${err?.message ?? err}`);
                if (attempt < DISPOSABLE_EMAIL_DOWNLOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
            }
        }
        return '';
    }
}
