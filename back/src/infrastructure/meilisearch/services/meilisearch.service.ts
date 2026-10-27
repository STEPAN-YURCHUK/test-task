import { Injectable, Logger } from '@nestjs/common';
import { MeiliSearch, SearchParams } from 'meilisearch';
import { MeiliIndexEnum } from '../enums/meili-index.enum';
import { meiliIndexUid, reconfigureMeiliIndex } from '../meilisearch.init';

const PRIMARY_KEY = 'uuid';

// Индекс потерял настройки или исчез (например, его удалили вручную, а первая запись создала заново
// без настроек) — тогда поиск падает с одной из этих ошибок
const INDEX_BROKEN_ERROR_CODES = new Set(['invalid_search_sort', 'invalid_search_filter', 'index_not_found']);

@Injectable()
export class MeiliSearchService {
    private readonly logger = new Logger(MeiliSearchService.name);

    // одна починка на индекс, параллельные запросы ждут её же
    private readonly repairs = new Map<MeiliIndexEnum, Promise<void>>();

    constructor(private readonly meiliSearch: MeiliSearch) {}

    private index(index: MeiliIndexEnum) {
        return this.meiliSearch.index(meiliIndexUid(index));
    }

    async add(index: MeiliIndexEnum, docs: any | any[]) {
        return this.index(index).addDocuments(Array.isArray(docs) ? docs : [docs], { primaryKey: PRIMARY_KEY });
    }

    // добавить и дождаться индексации: следующий поиск уже видит документ (и все поставленные раньше)
    async addAndWait(index: MeiliIndexEnum, docs: any | any[]) {
        await this.index(index)
            .addDocuments(Array.isArray(docs) ? docs : [docs], { primaryKey: PRIMARY_KEY })
            .waitTask({ timeout: 30_000 });
    }

    // частичное обновление: переданные поля перезаписываются, остальные остаются
    async update(index: MeiliIndexEnum, docs: any | any[]) {
        return this.index(index).updateDocuments(Array.isArray(docs) ? docs : [docs], { primaryKey: PRIMARY_KEY });
    }

    async countDocuments(index: MeiliIndexEnum): Promise<number> {
        return (await this.index(index).getStats()).numberOfDocuments;
    }

    // для тестов: дождаться применения всех поставленных задач индекса
    async waitForPendingTasks(index: MeiliIndexEnum): Promise<void> {
        const { results } = await this.meiliSearch.tasks.getTasks({
            indexUids: [meiliIndexUid(index)],
            statuses: ['enqueued', 'processing'],
        });
        if (results.length)
            await this.meiliSearch.tasks.waitForTasks(
                results.map((task) => task.uid),
                { timeout: 30_000 },
            );
    }

    async clear(index: MeiliIndexEnum): Promise<void> {
        await this.index(index).deleteAllDocuments().waitTask({ timeout: 30_000 });
    }

    async search(index: MeiliIndexEnum, query: string, options: SearchParams) {
        try {
            return await this.index(index).search(query, options);
        } catch (err) {
            const code = err?.cause?.code;
            if (!INDEX_BROKEN_ERROR_CODES.has(code)) throw err;

            this.logger.warn(`Index ${index} looks reset (${code}), reconfiguring`);
            await this.repairIndex(index);
            return await this.index(index).search(query, options);
        }
    }

    private async repairIndex(index: MeiliIndexEnum) {
        let repair = this.repairs.get(index);
        if (!repair) {
            repair = reconfigureMeiliIndex(this.meiliSearch, index).finally(() => this.repairs.delete(index));
            this.repairs.set(index, repair);
        }
        await repair;
    }
}
