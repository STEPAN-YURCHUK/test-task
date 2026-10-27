import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitFileUploadDto } from 'src/shared/file/dtos/init-file-upload.dto';
import { ClientCreateCommentDto } from './client.create-comment.dto';
import { ClientFindAllCommentsDto } from './client.find-all-comments.dto';
import { ClientPreviewCommentDto } from './client.preview-comment.dto';
import { ClientFindMyVotesDto } from '../../comment-vote/dtos/client.find-my-votes.dto';
import { ClientVoteCommentDto } from '../../comment-vote/dtos/client.vote-comment.dto';

const errorsOf = async <T extends object>(cls: new () => T, plain: Record<string, unknown>) => {
    const instance = plainToInstance(cls, plain);
    const errors = await validate(instance, { whitelist: true });
    return { instance, errors: Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})])) };
};

const validComment = {
    userName: 'John2024',
    email: 'john@example.com',
    text: 'Hello <strong>world</strong>',
    captchaToken: 'token',
    captcha: 'aB3dE9',
};

describe('ClientCreateCommentDto', () => {
    it('валидный набор полей', async () => {
        expect((await errorsOf(ClientCreateCommentDto, validComment)).errors).toEqual({});
    });

    it('пробелы обрезаются, пустые homePage/parentUuid → undefined', async () => {
        const { instance, errors } = await errorsOf(ClientCreateCommentDto, {
            ...validComment,
            userName: '  John  ',
            email: ' j@x.io ',
            homePage: '   ',
            parentUuid: '',
        });
        expect(errors).toEqual({});
        expect(instance).toMatchObject({ userName: 'John', email: 'j@x.io', homePage: undefined, parentUuid: undefined });
    });

    it('нестроковые значения в трансформерах не ломаются', async () => {
        const { errors } = await errorsOf(ClientCreateCommentDto, { ...validComment, userName: 123, homePage: 5 });
        expect(errors.userName).toContain('is_string');
        expect(errors.homePage).toContain('is_url');
    });

    it.each([
        ['userName', 'John Doe', 'user_name_alphanumeric'],
        ['userName', 'Иван', 'user_name_alphanumeric'],
        ['userName', 'a'.repeat(51), 'max_length_50'],
        ['userName', '', 'is_not_empty'],
        ['email', 'not-an-email', 'is_email'],
        ['homePage', 'ftp://x.io', 'is_url'],
        ['homePage', 'example.com', 'is_url'],
        ['text', '<script>x</script>', 'text_tag_not_allowed'],
        ['text', 'x'.repeat(5001), 'max_length_5000'],
        ['parentUuid', 'not-uuid', 'is_uuid'],
        ['uploadId', 'not-uuid', 'is_uuid'],
        ['captcha', 'ab c', 'captcha_alphanumeric'],
        ['captcha', 'a'.repeat(11), 'max_length_10'],
    ])('%s = %j → %s', async (field, value, key) => {
        expect((await errorsOf(ClientCreateCommentDto, { ...validComment, [field]: value })).errors[field]).toContain(key);
    });

    it('валидные homePage и uuid', async () => {
        const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
        expect(
            (await errorsOf(ClientCreateCommentDto, { ...validComment, homePage: 'https://j.dev', parentUuid: uuid, uploadId: uuid }))
                .errors,
        ).toEqual({});
    });
});

describe('ClientFindAllCommentsDto', () => {
    it('page из строки в число', async () => {
        const { instance, errors } = await errorsOf(ClientFindAllCommentsDto, { page: '3', sortBy: 'rating', sortOrder: 'ASC' });
        expect(errors).toEqual({});
        expect(instance.page).toBe(3);
    });

    it.each([
        [{ page: '0' }, 'page'],
        [{ page: '1.5' }, 'page'],
        [{ page: '100001' }, 'page'],
        [{ sortBy: 'text; DROP TABLE' }, 'sortBy'],
        [{ sortOrder: 'sideways' }, 'sortOrder'],
    ])('%j невалидно', async (plain, field) => {
        expect((await errorsOf(ClientFindAllCommentsDto, plain)).errors[field]).toBeDefined();
    });

    it('всё необязательно', async () => {
        expect((await errorsOf(ClientFindAllCommentsDto, {})).errors).toEqual({});
    });
});

describe('ClientPreviewCommentDto', () => {
    it('пустой / запрещённый тег', async () => {
        expect((await errorsOf(ClientPreviewCommentDto, { text: '' })).errors.text).toContain('is_not_empty');
        expect((await errorsOf(ClientPreviewCommentDto, { text: '<b>x</b>' })).errors.text).toContain('text_tag_not_allowed');
        expect((await errorsOf(ClientPreviewCommentDto, { text: '<i>ok</i>' })).errors).toEqual({});
    });
});

describe('голоса', () => {
    it.each([[1], [-1], [0]])('value %d допустимо', async (value) => {
        expect((await errorsOf(ClientVoteCommentDto, { value })).errors).toEqual({});
    });

    it.each([[2], [0.5], ['1']])('value %j недопустимо', async (value) => {
        expect((await errorsOf(ClientVoteCommentDto, { value })).errors.value).toBeDefined();
    });

    it('uuids: массив uuid, не больше 1000', async () => {
        const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
        expect((await errorsOf(ClientFindMyVotesDto, { uuids: [uuid] })).errors).toEqual({});
        expect((await errorsOf(ClientFindMyVotesDto, { uuids: 'x' })).errors.uuids).toContain('is_array');
        expect((await errorsOf(ClientFindMyVotesDto, { uuids: ['nope'] })).errors.uuids).toContain('is_uuid');
        expect((await errorsOf(ClientFindMyVotesDto, { uuids: Array(1001).fill(uuid) })).errors.uuids).toContain('array_max_size');
    });
});

describe('InitFileUploadDto', () => {
    it('имя обрезается, размер в пределах 200 МБ', async () => {
        const { instance, errors } = await errorsOf(InitFileUploadDto, { filename: '  a.png ', size: 10 });
        expect(errors).toEqual({});
        expect(instance.filename).toBe('a.png');
    });

    it.each([
        [{ filename: '', size: 1 }, 'filename'],
        [{ filename: 'a'.repeat(256), size: 1 }, 'filename'],
        [{ filename: 'a.png', size: 0 }, 'size'],
        [{ filename: 'a.png', size: 200 * 1024 * 1024 + 1 }, 'size'],
        [{ filename: 'a.png', size: 1.5 }, 'size'],
        [{ filename: 7, size: 1 }, 'filename'],
    ])('%j невалидно', async (plain, field) => {
        expect((await errorsOf(InitFileUploadDto, plain)).errors[field]).toBeDefined();
    });
});
