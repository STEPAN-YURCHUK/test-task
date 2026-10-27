import { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { ApiTags, OpenAPIObject } from '@nestjs/swagger';

type TagGroup = { name: string; tags: string[] };

const OTHER_GROUP_NAME = 'Other';

// src/modules/comment-manager/... → comment; src/shared/file/... → file; работает и для dist/, dist-e2e/.
// Привязка к src|dist: папка shared/ выше по пути (например /srv/shared/app/...) не должна совпасть
export const GROUP_DIR_PATTERN = /[\\/](?:src|dist[^\\/]*)[\\/](?:modules[\\/]([^\\/]+)-manager|shared[\\/]([^\\/]+))[\\/]/;

// @nestjs/swagger не отдаёт ключ метаданных @ApiTags наружу — снимаем его с пробного класса
export const API_TAGS_METADATA_KEY = (() => {
    const probeTag = '__api_tags_probe__';
    class Probe {}
    ApiTags(probeTag)(Probe);
    return Reflect.getMetadataKeys(Probe).find((key) => {
        const value = Reflect.getMetadata(key, Probe);
        return Array.isArray(value) && value[0] === probeTag;
    }) as string;
})();

/**
 * Группирует теги OpenAPI по папкам кода (`src/modules/<name>-manager`, `src/shared/<name>`) —
 * Scalar читает расширение `x-tagGroups` и рисует каждую группу отдельной секцией сайдбара.
 * Список не поддерживается руками: группа контроллера определяется по файлу, в котором он объявлен.
 */
export const applySwaggerTagGroups = (app: INestApplication, document: OpenAPIObject) => {
    const usedTags = collectUsedTags(document);
    const tagsByGroup = new Map<string, Set<string>>();

    for (const module of app.get(ModulesContainer).values()) {
        for (const controller of module.controllers.values()) {
            const tags: string[] = (Reflect.getMetadata(API_TAGS_METADATA_KEY, controller.metatype) ?? []).filter((tag: string) =>
                usedTags.has(tag),
            );
            if (!tags.length) continue;

            const group = toGroupName(findGroupDir(controller.metatype));
            const set = tagsByGroup.get(group) ?? new Set<string>();
            tags.forEach((tag) => set.add(tag));
            tagsByGroup.set(group, set);
        }
    }

    // теги без контроллера в известных папках — в «Other», иначе Scalar их спрячет
    const grouped = new Set([...tagsByGroup.values()].flatMap((set) => [...set]));
    const other = new Set([...(tagsByGroup.get(OTHER_GROUP_NAME) ?? []), ...[...usedTags].filter((tag) => !grouped.has(tag))]);
    tagsByGroup.delete(OTHER_GROUP_NAME);

    const groups: TagGroup[] = [...tagsByGroup.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, tags]) => ({ name, tags: [...tags].sort() }));
    if (other.size) groups.push({ name: OTHER_GROUP_NAME, tags: [...other].sort() });

    (document as OpenAPIObject & { 'x-tagGroups': TagGroup[] })['x-tagGroups'] = groups;
};

// теги из операций, а не из метаданных: исключённые контроллеры в документ не попадают
const collectUsedTags = (document: OpenAPIObject) => {
    const tags = new Set<string>();
    for (const pathItem of Object.values(document.paths ?? {})) {
        for (const operation of Object.values(pathItem ?? {})) {
            (operation as { tags?: string[] })?.tags?.forEach((tag) => tags.add(tag));
        }
    }
    return tags;
};

// класс → файл, из которого он экспортирован: CommonJS-кеш помнит exports каждого модуля.
// Смотрим только свои файлы и через дескрипторы — геттеры чужих пакетов не дёргаем
const findGroupDir = (controllerClass: object): string | undefined => {
    for (const loaded of Object.values(require.cache)) {
        const match = loaded?.filename.match(GROUP_DIR_PATTERN);
        if (!match || !loaded.exports || typeof loaded.exports !== 'object') continue;

        const exportsClass = Object.values(Object.getOwnPropertyDescriptors(loaded.exports)).some(
            (descriptor) => descriptor.value === controllerClass,
        );
        if (exportsClass) return match[1] ?? match[2];
    }
    return undefined;
};

// comment → Comment, comment-vote → Comment Vote
const toGroupName = (dir?: string) =>
    dir
        ? dir
              .split('-')
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ')
        : OTHER_GROUP_NAME;
