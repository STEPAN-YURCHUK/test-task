import { HttpException, HttpStatus } from '@nestjs/common';

// Разрешённые теги и их атрибуты. Всё остальное — либо экранируется как текст, либо ошибка валидации.
const ALLOWED_TAGS: Record<string, string[]> = {
    a: ['href', 'title'],
    code: [],
    i: [],
    strong: [],
};

// Похоже на тег: "<" сразу за которым буква или "/" + буква. Такие конструкции разбираем строго,
// одиночные "<" (например "a < b") считаем обычным текстом и экранируем.
const TAG_LIKE = /<\/?[a-zA-Z]/y;
const OPEN_TAG = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*>/y;
const CLOSE_TAG = /<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/y;
const ATTRIBUTE = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const SAFE_URL = /^https?:\/\/[^\s"'<>]+$/i;

export const COMMENT_TEXT_MAX_LENGTH = 5000;

export function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fail(key: string, detail?: string): never {
    throw new HttpException(detail ? `${key}:${detail}` : key, HttpStatus.BAD_REQUEST);
}

function buildOpenTag(tag: string, rawAttributes: string): string {
    const allowed = ALLOWED_TAGS[tag];
    const attributes: string[] = [];
    const seen = new Set<string>();

    for (const match of rawAttributes.matchAll(ATTRIBUTE)) {
        const name = match[1].toLowerCase();
        const value = (match[2] ?? match[3]).trim();

        if (!allowed.includes(name)) fail('text_attribute_not_allowed', `${tag}.${name}`);
        if (seen.has(name)) fail('text_attribute_duplicated', `${tag}.${name}`);
        if (name === 'href' && !SAFE_URL.test(value)) fail('text_unsafe_url');

        seen.add(name);
        attributes.push(` ${name}="${escapeHtml(value)}"`);
    }

    if (tag === 'a' && !seen.has('href')) fail('text_link_href_required');

    return `<${tag}${attributes.join('')}>`;
}

/**
 * Превращает пользовательский текст в валидный XHTML-фрагмент:
 * - разрешены только <a href title>, <code>, <i>, <strong>;
 * - каждый тег обязан быть закрыт в правильном порядке, <a> внутри <a> запрещён;
 * - текст и значения атрибутов экранируются, href только http(s).
 * Невалидный ввод → HttpException с i18n-ключом (`text_*`).
 */
export function sanitizeCommentHtml(raw: string): string {
    const input = raw.replace(/\r\n?/g, '\n');
    const stack: string[] = [];
    let output = '';
    let position = 0;

    while (position < input.length) {
        const next = input.indexOf('<', position);
        if (next === -1) {
            output += escapeHtml(input.slice(position));
            break;
        }

        output += escapeHtml(input.slice(position, next));
        position = next;

        TAG_LIKE.lastIndex = position;
        if (!TAG_LIKE.test(input)) {
            output += '&lt;';
            position += 1;
            continue;
        }

        CLOSE_TAG.lastIndex = position;
        const close = CLOSE_TAG.exec(input);
        if (close) {
            const tag = close[1].toLowerCase();
            if (!(tag in ALLOWED_TAGS)) fail('text_tag_not_allowed', tag);
            if (stack[stack.length - 1] !== tag) fail('text_unexpected_closing_tag', tag);

            stack.pop();
            output += `</${tag}>`;
            position = CLOSE_TAG.lastIndex;
            continue;
        }

        OPEN_TAG.lastIndex = position;
        const open = OPEN_TAG.exec(input);
        if (!open) fail('text_malformed_tag');

        const tag = open[1].toLowerCase();
        if (!(tag in ALLOWED_TAGS)) fail('text_tag_not_allowed', tag);
        if (tag === 'a' && stack.includes('a')) fail('text_nested_link');

        stack.push(tag);
        output += buildOpenTag(tag, open[2]);
        position = OPEN_TAG.lastIndex;
    }

    if (stack.length) fail('text_tag_not_closed', stack[stack.length - 1]);

    return output;
}

// Длина видимого текста без разметки — для проверки «пустого» сообщения из одних тегов
export function getCommentPlainText(html: string): string {
    return html.replace(/<[^>]+>/g, '').trim();
}
