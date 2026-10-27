import { Controller } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { ApiTags, OpenAPIObject } from '@nestjs/swagger';
import { ClientCaptchaController } from 'src/modules/captcha-manager/captcha/controllers/client.captcha.controller';
import { ClientCommentVoteController } from 'src/modules/comment-manager/comment-vote/controllers/client.comment-vote.controller';
import { ClientCommentController } from 'src/modules/comment-manager/comment/controllers/client.comment.controller';
import { ClientFileUploadController } from 'src/shared/file/controllers/client.file-upload.controller';
import { ValidationErrorResponse } from './responses/validation-error.response';
import { errorExample, errorExamples } from './swagger-error.helper';
import { ApiAcceptLanguageHeader } from './swagger.headers';
import { API_TAGS_METADATA_KEY, applySwaggerTagGroups, GROUP_DIR_PATTERN } from './swagger-tag-groups.helper';

// не экспортируется ни из одного модуля — группу по файлу не найти → «Other»
@ApiTags('[Client] Orphan')
@Controller('orphan')
class OrphanController {}

@Controller('untagged')
class UntaggedController {}

const appWith = (controllers: unknown[]) =>
    ({
        get: (token: unknown) => {
            if (token !== ModulesContainer) throw new Error('unexpected token');
            const module = { controllers: new Map(controllers.map((metatype, i) => [i, { metatype }])) };
            return new Map([['m', module]]);
        },
    }) as any;

const documentWithTags = (...tags: string[]) =>
    ({
        paths: Object.fromEntries(tags.map((tag, i) => [`/p${i}`, { get: { tags: [tag] }, parameters: undefined }])),
    }) as unknown as OpenAPIObject;

describe('swagger helpers', () => {
    describe('errorExample / errorExamples', () => {
        it('пример в форме GlobalExceptionFilter с текстом из errors.json', () => {
            const { schema } = errorExample(404, 'comment_not_found') as any;
            expect(schema.example).toEqual({ status: 404, code: 'comment_not_found', message: 'Comment not found' });
            expect(schema.properties.message.example).toBe('Comment not found');
        });

        it('неизвестный ключ — сам ключ вместо текста', () => {
            expect((errorExample(400, 'no_such_key') as any).schema.example.message).toBe('no_such_key');
            expect((errorExamples(400, ['no_such_key']) as any).content['application/json'].examples.no_such_key).toEqual({
                summary: 'no_such_key',
                value: { status: 400, code: 'no_such_key', message: 'no_such_key' },
            });
        });

        it('несколько ошибок с одним статусом — именованные примеры', () => {
            const { examples } = (errorExamples(400, ['captcha_invalid', 'captcha_expired']) as any).content['application/json'];
            expect(Object.keys(examples)).toEqual(['captcha_invalid', 'captcha_expired']);
            expect(examples.captcha_invalid.value).toEqual({ status: 400, code: 'captcha_invalid', message: 'Wrong CAPTCHA' });
        });
    });

    it('ApiAcceptLanguageHeader и ValidationErrorResponse — применимы как декораторы/типы', () => {
        class Target {
            @ApiAcceptLanguageHeader()
            handler() {}
        }
        expect(Target).toBeDefined();
        expect(new ValidationErrorResponse()).toBeInstanceOf(ValidationErrorResponse);
    });

    describe('applySwaggerTagGroups', () => {
        it.each([
            ['/app/back/src/modules/comment-manager/comment/controllers/x.js', 'comment'],
            ['/app/back/dist/shared/file/controllers/x.js', 'file'],
            ['/app/back/dist-e2e/modules/captcha-manager/captcha/x.js', 'captcha'],
            // папка shared/ выше проекта не считается группой
            ['/srv/shared/test-task/back/dist/modules/comment-manager/comment/x.js', 'comment'],
            ['/srv/shared/test-task/back/node_modules/pkg/x.js', undefined],
        ])('папка группы по пути %s → %s', (path, group) => {
            const match = path.match(GROUP_DIR_PATTERN);
            expect(match ? (match[1] ?? match[2]) : undefined).toBe(group);
        });

        it('ключ метаданных @ApiTags найден', () => {
            expect(Reflect.getMetadata(API_TAGS_METADATA_KEY, ClientCaptchaController)).toEqual(['[Client] Captcha']);
        });

        it('группирует теги по папкам кода, «Other» — последней, без тегов и неиспользуемых — пропускает', () => {
            const document = documentWithTags(
                '[Client] Comment',
                '[Client] Comment Vote',
                '[Client] Captcha',
                '[Client] Upload',
                '[Client] Orphan',
                'Loose tag',
            );
            applySwaggerTagGroups(
                appWith([
                    ClientCommentVoteController,
                    ClientCommentController,
                    ClientCaptchaController,
                    ClientFileUploadController,
                    OrphanController,
                    UntaggedController,
                ]),
                document,
            );

            expect((document as any)['x-tagGroups']).toEqual([
                { name: 'Captcha', tags: ['[Client] Captcha'] },
                { name: 'Comment', tags: ['[Client] Comment', '[Client] Comment Vote'] },
                { name: 'File', tags: ['[Client] Upload'] },
                { name: 'Other', tags: ['Loose tag', '[Client] Orphan'] },
            ]);
        });

        it('тег контроллера, которого нет в документе, не попадает в группы; без «Other», если всё сгруппировано', () => {
            const document = documentWithTags('[Client] Captcha');
            applySwaggerTagGroups(appWith([ClientCaptchaController, ClientCommentController]), document);
            expect((document as any)['x-tagGroups']).toEqual([{ name: 'Captcha', tags: ['[Client] Captcha'] }]);
        });

        it('пустой документ и пустой pathItem — пустые группы', () => {
            const document = { paths: { '/empty': null } } as unknown as OpenAPIObject;
            applySwaggerTagGroups(appWith([]), document);
            expect((document as any)['x-tagGroups']).toEqual([]);

            const withoutPaths = {} as OpenAPIObject;
            applySwaggerTagGroups(appWith([ClientCaptchaController]), withoutPaths);
            expect((withoutPaths as any)['x-tagGroups']).toEqual([]);
        });
    });
});
